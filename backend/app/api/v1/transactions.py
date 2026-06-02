from datetime import date as date_type, datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.deps import (
    ensure_project_access,
    get_current_user,
    require_admin,
    require_can_write,
    require_superadmin,
    user_project_ids,
)
from app.db.session import get_db
from app.models.models import (
    AuditAction,
    CashAdvanceSettlement,
    CashAdvanceSettlementItem,
    CashRequest,
    CashRequestStatus,
    Invoice,
    InvoiceAllocation,
    Project,
    ProjectKind,
    Transaction,
    TransactionAttachment,
    TransactionItem,
    TxnKind,
    TxnStatus,
    TxnType,
    User,
    UserRole,
)
from app.schemas.common import Page
from app.schemas.finance import (
    AttachmentOut,
    CancelIn,
    CashAdvanceBalanceRow,
    CashAdvanceSettlementIn,
    CashAdvanceSettlementOut,
    ExternalLinkIn,
    TransactionAllocationRef,
    TransactionCreate,
    TransactionOut,
    TransactionUpdate,
)
from app.services.audit import log, snapshot
from app.services.invoice_status import recompute_invoice_status
from app.services.storage.links import normalize_external_link
from app.services.storage.local import save_upload

router = APIRouter()


async def _build_allocation_refs(
    db: AsyncSession, txn_ids: list[int]
) -> dict[int, list[TransactionAllocationRef]]:
    """Map transaction_id -> list of allocations refs (1 query)."""
    if not txn_ids:
        return {}
    q = (
        select(InvoiceAllocation, Invoice)
        .join(Invoice, Invoice.id == InvoiceAllocation.invoice_id)
        .where(
            InvoiceAllocation.transaction_id.in_(txn_ids),
            InvoiceAllocation.deleted_at.is_(None),
        )
        .order_by(InvoiceAllocation.id)
    )
    rows = (await db.execute(q)).all()
    out: dict[int, list[TransactionAllocationRef]] = {}
    for a, inv in rows:
        out.setdefault(a.transaction_id, []).append(
            TransactionAllocationRef(
                id=a.id,
                invoice_id=inv.id,
                invoice_number=inv.number,
                invoice_total=inv.total,
                invoice_status=inv.status,
                allocated_amount=a.allocated_amount,
            )
        )
    return out


def _serialize(
    t: Transaction,
    allocs: list[TransactionAllocationRef] | None = None,
    *,
    recipient_display: str | None = None,
) -> TransactionOut:
    """Serialize Transaction ke TransactionOut.

    DEFENSIVE: tidak rely Pydantic from_attributes utk relationship --
    pakai dict-by-columns supaya tidak trigger lazy-load (MissingGreenlet
    di async context). Caller WAJIB eager-load relationship sebelum
    panggil ini, kalau perlu nilai-nya:
      - attachments (utk out.attachments)
      - items (utk out.items)
      - settlement (utk out.settlement_status)
    Kalau relationship belum loaded, fallback ke list kosong (safe).
    """
    from decimal import Decimal as _D
    from sqlalchemy import inspect as _sa_inspect
    from sqlalchemy.orm.base import LoaderCallableStatus as _LCS

    # Build dict dari kolom-kolom saja (SKIP relationship -- tidak akses
    # attr Mapped[list[...]] yg bisa lazy-load).
    insp = _sa_inspect(t)
    data: dict = {}
    for col in t.__table__.columns:
        attr_state = insp.attrs.get(col.name)
        if attr_state is not None:
            val = attr_state.loaded_value
            if val is _LCS.NO_VALUE:
                continue
            data[col.name] = val
    out = TransactionOut.model_validate(data)

    # Sekarang isi relationship dr attr yg sudah eager-loaded (safe access
    # karena query selectinload). Kalau caller lupa eager-load, tetap safe
    # -- kita cek via inspect dulu.
    def _safe_rel(name: str) -> list:
        st = insp.attrs.get(name)
        if st is None:
            return []
        val = st.loaded_value
        if val is _LCS.NO_VALUE or val is None:
            return []
        return list(val)

    atts = _safe_rel("attachments")
    out.attachments = [AttachmentOut.model_validate(a) for a in atts]
    items_rel = _safe_rel("items")
    if items_rel:
        from app.schemas.finance import TransactionItemOut
        out.items = [TransactionItemOut.model_validate(i) for i in items_rel]
    out.allocations = allocs or []
    allocated = sum((a.allocated_amount for a in (allocs or [])), start=_D("0"))
    out.allocated_amount = allocated
    out.remaining_amount = max(_D(t.amount or 0) - allocated, _D("0"))

    # CASH_ADVANCE only: status settlement (rel scalar, uselist=False).
    kind_val = data.get("kind") or ""
    if kind_val == TxnKind.CASH_ADVANCE.value or kind_val == TxnKind.CASH_ADVANCE:
        out.recipient_display = recipient_display or data.get("recipient_name")
        sett_state = insp.attrs.get("settlement")
        sett = None
        if sett_state is not None and sett_state.loaded_value is not _LCS.NO_VALUE:
            sett = sett_state.loaded_value
        out.settlement_status = "SETTLED" if sett else "OUTSTANDING"
        out.settlement_id = sett.id if sett else None
    return out


async def _serialize_with_allocs(db: AsyncSession, t: Transaction) -> TransactionOut:
    refs = (await _build_allocation_refs(db, [t.id])).get(t.id, [])
    # Lazy-load: items + settlement (kalau ada). Resolve recipient_user.name.
    from sqlalchemy.orm import selectinload as _sl
    res = await db.execute(
        select(Transaction)
        .options(
            _sl(Transaction.attachments),
            _sl(Transaction.items),
            _sl(Transaction.settlement),
        )
        .where(Transaction.id == t.id)
    )
    t = res.scalar_one()
    recipient_display = t.recipient_name
    if t.recipient_user_id and not recipient_display:
        u = await db.get(User, t.recipient_user_id)
        if u:
            recipient_display = u.name
    return _serialize(t, refs, recipient_display=recipient_display)


@router.get("", response_model=Page[TransactionOut])
async def list_transactions(
    project_id: list[int] | None = Query(None),
    company_id: int | None = None,
    type: TxnType | None = None,
    status: list[TxnStatus] | None = Query(None),
    category_id: int | None = None,
    vendor_client_id: int | None = None,
    invoice_id: int | None = None,
    date_from: date_type | None = None,
    date_to: date_type | None = None,
    q: str | None = None,
    # Filter berdasarkan kind proyek (REGULAR vs NON_PROJECT).
    # None/false (default) -> exclude tx di bucket NON_PROJECT (halaman
    # /transactions normal bersih dari catatan non-proyek).
    # True -> ONLY tx non-proyek (halaman /catatan-non-proyek).
    non_project: bool | None = None,
    # Audit 2026-05-24: filter "TX OUT yg belum/parsial dialokasi ke
    # invoice" -- drill-down dari dashboard counter "N pengeluaran masih
    # punya sisa belum dialokasi". TX yg remaining_amount > 0 only.
    unlinked_only: bool = Query(False),
    page: int = Query(1, ge=1),
    size: int = Query(50, ge=1, le=2000),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> Page[TransactionOut]:
    stmt = select(Transaction).where(Transaction.deleted_at.is_(None))
    # NON_PROJECT = bucket SUPERADMIN-only (rahasia). Audit 2026-05-22 #C2:
    # role lain (CENTRAL_ADMIN sekalipun) tdk boleh akses lewat
    # ?non_project=true. Default behavior tetap exclude NP.
    if non_project is True and user.role != UserRole.SUPERADMIN:
        raise HTTPException(403, "non_project_superadmin_only")
    # Sub-query daftar project_id yg kind=NON_PROJECT (biasanya cuma 1
    # per company). Pakai utk include/exclude di filter tx.
    np_pids_subq = select(Project.id).where(
        Project.kind == ProjectKind.NON_PROJECT.value
    ).scalar_subquery()
    if non_project is True:
        stmt = stmt.where(Transaction.project_id.in_(np_pids_subq))
    else:
        stmt = stmt.where(~Transaction.project_id.in_(np_pids_subq))
    pids = await user_project_ids(db, user)
    if pids is not None:
        if not pids:
            return Page(items=[], total=0, page=page, size=size)
        stmt = stmt.where(Transaction.project_id.in_(pids))
    if project_id:
        # Validate akses per project_id, lalu filter IN. Multi-select.
        for pid in project_id:
            await ensure_project_access(db, user, pid)
        stmt = stmt.where(Transaction.project_id.in_(project_id))
    if company_id:
        # Filter via Project.company_id. Subquery: project IDs di company tsb.
        from app.models.models import Project as _P
        co_pids_subq = select(_P.id).where(_P.company_id == company_id).scalar_subquery()
        stmt = stmt.where(Transaction.project_id.in_(co_pids_subq))
    if type:
        stmt = stmt.where(Transaction.type == type)
    if status:
        # Audit 2026-06-02: multi-status filter -- FE bisa kirim
        # ?status=DRAFT&status=SUBMITTED utk drill-down "belum verifikasi".
        stmt = stmt.where(Transaction.status.in_(status))
    if category_id:
        stmt = stmt.where(Transaction.category_id == category_id)
    if vendor_client_id:
        stmt = stmt.where(Transaction.vendor_client_id == vendor_client_id)
    if invoice_id:
        stmt = stmt.where(Transaction.invoice_id == invoice_id)
    if date_from:
        stmt = stmt.where(Transaction.tx_date >= date_from)
    if date_to:
        stmt = stmt.where(Transaction.tx_date <= date_to)
    if q:
        like = f"%{q}%"
        stmt = stmt.where(
            (Transaction.description.ilike(like))
            | (Transaction.party_name.ilike(like))
            | (Transaction.reference_no.ilike(like))
        )
    if unlinked_only:
        # TX OUT yg masih punya sisa belum dialokasi ke invoice.
        # Status DRAFT/SUBMITTED/VERIFIED only (CANCELLED tdk dihitung
        # outstanding). Audit 2026-05-24 -- match dashboard counter.
        from sqlalchemy import select as _sel
        alloc_sub = (
            _sel(
                InvoiceAllocation.transaction_id.label("txn_id"),
                func.coalesce(
                    func.sum(InvoiceAllocation.allocated_amount), 0,
                ).label("alloc_sum"),
            )
            .where(InvoiceAllocation.deleted_at.is_(None))
            .group_by(InvoiceAllocation.transaction_id)
            .subquery()
        )
        # Audit 2026-05-27: exclude kind=DIRECT_EXPENSE -- TX itu memang tdk
        # dialokasikan ke invoice (beban tercatat in-place via items), jadi
        # tdk masuk filter "belum dialokasi".
        stmt = stmt.outerjoin(
            alloc_sub, alloc_sub.c.txn_id == Transaction.id,
        ).where(
            Transaction.type == TxnType.OUT,
            Transaction.status.in_([
                TxnStatus.DRAFT, TxnStatus.SUBMITTED, TxnStatus.VERIFIED,
            ]),
            Transaction.kind != TxnKind.DIRECT_EXPENSE.value,
            (Transaction.amount - func.coalesce(alloc_sub.c.alloc_sum, 0)) > 0,
        )
    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar_one()
    stmt = (
        stmt.options(
            selectinload(Transaction.attachments),
            selectinload(Transaction.items),
            selectinload(Transaction.settlement),
        )
        .order_by(Transaction.tx_date.desc(), Transaction.id.desc())
        .offset((page - 1) * size)
        .limit(size)
    )
    items = (await db.execute(stmt)).scalars().all()
    refs_by_id = await _build_allocation_refs(db, [t.id for t in items])
    return Page(
        items=[_serialize(t, refs_by_id.get(t.id, [])) for t in items],
        total=total, page=page, size=size,
    )


def _validate_kind_invariants(
    payload: TransactionCreate | TransactionUpdate,
    *,
    tx_type: TxnType,
    kind: TxnKind,
    amount,
    items: list,
) -> None:
    """Cek aturan akunting per kind. Raise HTTPException(400) kalau melanggar."""
    from decimal import Decimal as _D
    # CASH_ADVANCE: hanya OUT + recipient wajib + items kosong (settlement nanti)
    if kind == TxnKind.CASH_ADVANCE:
        if tx_type != TxnType.OUT:
            raise HTTPException(400, "cash_advance_must_be_out")
        ru = getattr(payload, "recipient_user_id", None)
        rn = (getattr(payload, "recipient_name", None) or "").strip()
        if not ru and not rn:
            raise HTTPException(
                400,
                "recipient_required: CASH_ADVANCE perlu recipient_user_id "
                "atau recipient_name (salah satu)",
            )
        if items:
            raise HTTPException(
                400,
                "items_not_allowed: CASH_ADVANCE tdk pakai items, rincian di "
                "settlement (POST /transactions/{id}/settle)",
            )
    elif kind == TxnKind.DIRECT_EXPENSE:
        if tx_type != TxnType.OUT:
            raise HTTPException(400, "direct_expense_must_be_out")
        if not items:
            raise HTTPException(
                400,
                "items_required: DIRECT_EXPENSE wajib punya >=1 line item",
            )
        # items bisa berbentuk: list[TransactionItemIn] (Pydantic dr payload),
        # list[dict] (dr model_dump), atau list[TransactionItem] (ORM dr t.items).
        # Support semua via _read_item_amount.
        total = sum(
            (_read_item_amount(i) for i in items), start=_D("0")
        )
        if total != _D(amount or 0):
            raise HTTPException(
                400,
                f"items_sum_mismatch: sum(items.amount)={total} != "
                f"amount={amount}. Total harus sama persis.",
            )


def _read_item_amount(i) -> "Decimal":
    """Read amount dr item -- support dict (model_dump output), Pydantic
    instance, atau ORM row. Defensif terhadap shape input."""
    from decimal import Decimal
    if isinstance(i, dict):
        return Decimal(str(i.get("amount") or 0))
    val = getattr(i, "amount", None)
    return Decimal(str(val or 0))


def _get_item_field(i, key):
    """Read field dr item -- support dict / Pydantic / ORM row."""
    if isinstance(i, dict):
        return i.get(key)
    return getattr(i, key, None)


@router.post("", response_model=TransactionOut, status_code=201)
async def create_transaction(
    payload: TransactionCreate,
    force: bool = Query(False, description="SUPERADMIN-only: bypass project_closed guard"),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_can_write),
) -> TransactionOut:
    await ensure_project_access(db, user, payload.project_id)
    # Audit 2026-05-24 Phase 1: block create di proyek SELESAI / DIBATALKAN.
    # SUPERADMIN bypass dgn ?force=true (audit log tagging).
    from app.services.project_guard import assert_project_open
    _, forced = await assert_project_open(
        db, payload.project_id, user=user, force=force,
    )
    _validate_kind_invariants(
        payload, tx_type=payload.type, kind=payload.kind,
        amount=payload.amount, items=payload.items,
    )
    # Validate recipient_user_id exist kalau diisi
    if payload.recipient_user_id:
        ru = await db.get(User, payload.recipient_user_id)
        if not ru:
            raise HTTPException(400, "recipient_user_not_found")
    data = payload.model_dump(exclude={"items"})
    t = Transaction(**data, status=TxnStatus.DRAFT, created_by_id=user.id)
    db.add(t)
    await db.flush()
    # Bikin items (DIRECT_EXPENSE) -- mirror payload list
    for it in payload.items:
        db.add(TransactionItem(
            transaction_id=t.id,
            category_id=it.category_id,
            description=it.description,
            amount=it.amount,
        ))
    if t.invoice_id:
        inv = await db.get(Invoice, t.invoice_id)
        if inv:
            await recompute_invoice_status(db, inv)
    await db.refresh(
        t, attribute_names=[c.name for c in Transaction.__table__.columns]
    )
    await log(db, user_id=user.id, entity="transaction", entity_id=t.id,
              action=AuditAction.CREATE, after=snapshot(t),
              note="FORCE bypass closed project" if forced else None)
    await db.commit()
    return await _serialize_with_allocs(db, t)


@router.get("/{tid}", response_model=TransactionOut)
async def get_transaction(
    tid: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> TransactionOut:
    res = await db.execute(
        select(Transaction).options(selectinload(Transaction.attachments), selectinload(Transaction.items), selectinload(Transaction.settlement)).where(Transaction.id == tid)
    )
    t = res.scalar_one_or_none()
    if not t or t.deleted_at is not None:
        raise HTTPException(404, "not_found")
    await ensure_project_access(db, user, t.project_id)
    return await _serialize_with_allocs(db, t)


@router.patch("/{tid}", response_model=TransactionOut)
async def update_transaction(
    tid: int,
    payload: TransactionUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_can_write),
) -> TransactionOut:
    # PENTING: eager-load items + attachments + settlement supaya saat
    # iterate t.items / akses field utk delete tidak trigger lazy-load
    # di async context (MissingGreenlet). db.get() default tdk eager-load.
    res = await db.execute(
        select(Transaction)
        .options(
            selectinload(Transaction.items),
            selectinload(Transaction.attachments),
            selectinload(Transaction.settlement),
        )
        .where(Transaction.id == tid)
    )
    t = res.scalar_one_or_none()
    if not t or t.deleted_at is not None:
        raise HTTPException(404, "not_found")
    await ensure_project_access(db, user, t.project_id)
    is_god = user.role == UserRole.SUPERADMIN
    # Audit 2026-05-23 user req: DRAFT bebas; non-DRAFT IMMUTABLE
    # kecuali SUPERADMIN (god-mode). Konsekuensi konsistensi (allocations,
    # report agregat retro-active) ditanggung SUPERADMIN -- audit log
    # catat before/after.
    if payload.project_id is not None and payload.project_id != t.project_id:
        if t.status != TxnStatus.DRAFT and not is_god:
            raise HTTPException(
                400,
                "project_change_forbidden: tx non-DRAFT tidak bisa pindah "
                "proyek (butuh SUPERADMIN). Cancel tx + buat ulang di proyek "
                "benar.",
            )
        # Validate akses ke proyek tujuan + proyek exists & not deleted.
        await ensure_project_access(db, user, payload.project_id)
        target = (
            await db.execute(
                select(Project).where(
                    Project.id == payload.project_id,
                    Project.deleted_at.is_(None),
                )
            )
        ).scalar_one_or_none()
        if target is None:
            raise HTTPException(400, "target_project_not_found")
    # VERIFIED: hanya SUPERADMIN yang boleh modifikasi (god-mode).
    # Audit trail keuangan harus kuat -- CENTRAL_ADMIN tidak boleh
    # ubah transaksi/lampiran yang sudah tervalidasi. Untuk koreksi,
    # gunakan workflow CANCEL (POST /:id/cancel) lalu buat ulang.
    if t.status == TxnStatus.VERIFIED and user.role != UserRole.SUPERADMIN:
        raise HTTPException(409, "verified_locked")
    # Kalau ini CASH_ADVANCE yg sudah ke-settle, lock edit -- supaya saldo
    # akunting tdk inkonsisten dgn settlement.
    # SUPERADMIN god-mode bypass (audit 2026-05-23 user req).
    if t.kind == TxnKind.CASH_ADVANCE and not is_god:
        settlement = (await db.execute(
            select(CashAdvanceSettlement).where(
                CashAdvanceSettlement.cash_advance_tx_id == t.id
            )
        )).scalar_one_or_none()
        if settlement:
            raise HTTPException(
                409,
                "cash_advance_already_settled: edit dilarang, hapus "
                "settlement dulu (atau pakai SUPERADMIN god-mode).",
            )
    data = payload.model_dump(exclude_unset=True)
    # project_id sudah di-validate di atas: kalau berubah, status harus
    # DRAFT + user punya akses ke proyek tujuan + proyek tujuan exists.
    # Lolos guard -> boleh setattr (akan masuk loop di bawah).
    items_payload = data.pop("items", None)
    new_kind = data.pop("kind", None)

    # Ubah kind:
    # - Status VERIFIED sudah di-block oleh rule 'verified_locked' di
    #   atas (semua edit, termasuk kind) -- hanya SUPERADMIN yg bypass.
    # - Selain VERIFIED: siapa pun yg lolos require_can_write boleh ubah
    #   kind (tdk perlu admin -- tx DRAFT masih editable penuh).
    # - TETAP CEK: alokasi invoice. Pindah kind dr INVOICE_PAYMENT setelah
    #   ada allocation akan rusak data akunting -- block dgn 409.
    if new_kind is not None and new_kind != t.kind:
        # Cek alokasi invoice (invoice_id langsung atau InvoiceAllocation row)
        alloc_exists = (await db.execute(
            select(InvoiceAllocation.id).where(
                InvoiceAllocation.transaction_id == t.id,
                InvoiceAllocation.deleted_at.is_(None),
            ).limit(1)
        )).scalar_one_or_none() is not None
        if alloc_exists or t.invoice_id:
            raise HTTPException(
                409,
                "kind_change_blocked: tx sudah ter-alokasi ke invoice. "
                "Hapus alokasi/unlink invoice dulu.",
            )
        # Reset field2 yg tdk berlaku di kind baru
        if new_kind != TxnKind.INVOICE_PAYMENT:
            data["invoice_id"] = None
            data["purchase_order_id"] = None
        if new_kind != TxnKind.CASH_ADVANCE:
            data["recipient_user_id"] = None
            data["recipient_name"] = None
        if new_kind != TxnKind.DIRECT_EXPENSE:
            # Drop items lama (akan di-handle kalau bukan DIRECT_EXPENSE)
            if items_payload is None:
                items_payload = []   # force clear
        # Set kind baru
        data["kind"] = new_kind

    # Validate invariants utk kind effective (baru atau lama)
    effective_kind = new_kind if new_kind else t.kind
    if items_payload is not None or "amount" in data or new_kind is not None:
        new_amount = data.get("amount", t.amount)
        items_check = items_payload if items_payload is not None else (t.items or [])
        # Pakai payload utk recipient check, tapi kind dr effective
        _validate_kind_invariants(
            payload, tx_type=t.type, kind=effective_kind,
            amount=new_amount, items=items_check,
        )
    if payload.recipient_user_id:
        ru = await db.get(User, payload.recipient_user_id)
        if not ru:
            raise HTTPException(400, "recipient_user_not_found")
    before = snapshot(t)
    for k, v in data.items():
        setattr(t, k, v)
    # Replace items kalau diisi (DIRECT_EXPENSE) atau kind berubah ke non-DIRECT
    if items_payload is not None:
        # Hapus item lama, masukkan yg baru
        for it in list(t.items or []):
            await db.delete(it)
        for it in items_payload:
            # items_payload bisa list[dict] (dr model_dump) atau
            # list[TransactionItemIn] (Pydantic, kalau caller belum
            # model_dump). Helper _get_item_field handle dua-duanya.
            db.add(TransactionItem(
                transaction_id=t.id,
                category_id=_get_item_field(it, "category_id"),
                description=_get_item_field(it, "description") or "",
                amount=_get_item_field(it, "amount") or 0,
            ))
    if t.invoice_id:
        inv = await db.get(Invoice, t.invoice_id)
        if inv:
            await recompute_invoice_status(db, inv)
    await log(db, user_id=user.id, entity="transaction", entity_id=t.id,
              action=AuditAction.UPDATE, before=before, after=snapshot(t))
    await db.commit()
    return await _serialize_with_allocs(db, t)


@router.post("/bulk/verify")
async def bulk_verify_transactions(
    payload: dict,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict:
    """Bulk verify TX (SUPERADMIN / CENTRAL_ADMIN). Audit 2026-05-23.

    Payload: {ids: list[int]}.
    Return: {success: list[int], skipped: list[{id, reason}],
             total_requested: int, success_count: int}.

    Per-item processing: tx invalid (404 / not in DRAFT|SUBMITTED) di-skip
    dgn reason, tx valid di-verify + audit log + commit di akhir batch.
    Tdk halt seluruh batch karena 1 error.

    PENTING: route ini HARUS register sebelum `/{tid}/verify` --
    kalau tdk, FastAPI match "bulk" sbg tid (int) -> 422
    validation error. Jangan pindah ke bawah!
    """
    ids = payload.get("ids") or []
    if not isinstance(ids, list) or not ids:
        raise HTTPException(400, "ids_required")
    if len(ids) > 500:
        raise HTTPException(400, "max_500_per_batch")

    res = await db.execute(
        select(Transaction)
        .options(
            selectinload(Transaction.items),
            selectinload(Transaction.attachments),
            selectinload(Transaction.settlement),
        )
        .where(Transaction.id.in_(ids))
    )
    txs = {t.id: t for t in res.scalars().all()}

    success_ids: list[int] = []
    skipped: list[dict] = []
    now = datetime.now(timezone.utc)

    for tid in ids:
        t = txs.get(tid)
        if t is None or t.deleted_at is not None:
            skipped.append({"id": tid, "reason": "not_found"})
            continue
        if t.status not in (TxnStatus.SUBMITTED, TxnStatus.DRAFT):
            skipped.append({"id": tid, "reason": f"invalid_state_{t.status.value}"})
            continue
        before = snapshot(t)
        t.status = TxnStatus.VERIFIED
        t.verified_by_id = admin.id
        t.verified_at = now
        if t.invoice_id:
            inv = await db.get(Invoice, t.invoice_id)
            if inv:
                await recompute_invoice_status(db, inv)
        await log(
            db, user_id=admin.id, entity="transaction", entity_id=t.id,
            action=AuditAction.VERIFY, before=before, after=snapshot(t),
            note="bulk verify",
        )
        success_ids.append(tid)

    await db.commit()

    # Notif dilakukan post-commit (best-effort). Tdk block kalau gagal.
    try:
        from app.services.messaging import notify_transaction_verified
        for tid in success_ids:
            t = txs.get(tid)
            if t:
                await notify_transaction_verified(db, t, actor_id=admin.id)
    except Exception:  # noqa: BLE001
        pass

    return {
        "total_requested": len(ids),
        "success_count": len(success_ids),
        "success": success_ids,
        "skipped": skipped,
    }


@router.post("/bulk/delete")
async def bulk_delete_transactions(
    payload: dict,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict:
    """Bulk soft-delete TX. Audit 2026-05-24 user req mass action.

    Payload: {ids: list[int]}.
    Return: {total_requested, success_count, success, skipped}.

    Per-item:
    - CENTRAL_ADMIN: VERIFIED ditolak (mirror single delete strict).
    - SUPERADMIN (god-mode 2026-05-24): bypass status check, cascade
      soft-delete allocations + recompute invoice status terdampak.
      Konsisten dgn single /hard endpoint (god-mode).
    """
    ids = payload.get("ids") or []
    if not isinstance(ids, list) or not ids:
        raise HTTPException(400, "ids_required")
    if len(ids) > 500:
        raise HTTPException(400, "max_500_per_batch")

    god = admin.role == UserRole.SUPERADMIN

    res = await db.execute(
        select(Transaction).where(Transaction.id.in_(ids))
    )
    txs = {t.id: t for t in res.scalars().all()}

    success_ids: list[int] = []
    skipped: list[dict] = []
    now = datetime.utcnow()
    affected_inv_ids: set[int] = set()

    for tid in ids:
        t = txs.get(tid)
        if t is None or t.deleted_at is not None:
            skipped.append({"id": tid, "reason": "not_found"})
            continue
        if not god and t.status == TxnStatus.VERIFIED:
            skipped.append({"id": tid, "reason": "verified_must_be_cancelled"})
            continue
        before = snapshot(t)

        # God-mode: cascade soft-delete allocations + collect invoices
        # utk recompute setelah loop selesai.
        if god:
            alloc_res = await db.execute(
                select(InvoiceAllocation).where(
                    InvoiceAllocation.transaction_id == t.id,
                    InvoiceAllocation.deleted_at.is_(None),
                )
            )
            for a in alloc_res.scalars().all():
                a.deleted_at = now
                affected_inv_ids.add(a.invoice_id)
            if t.invoice_id:
                affected_inv_ids.add(t.invoice_id)

        t.deleted_at = now
        await log(
            db, user_id=admin.id, entity="transaction", entity_id=t.id,
            action=AuditAction.DELETE, before=before,
            note="bulk delete (god-mode)" if god else "bulk delete",
        )
        success_ids.append(tid)

    # Recompute invoice status terdampak (sekali per invoice, di luar loop)
    for iid in affected_inv_ids:
        inv = await db.get(Invoice, iid)
        if inv and inv.deleted_at is None:
            await recompute_invoice_status(db, inv)

    await db.commit()
    return {
        "total_requested": len(ids),
        "success_count": len(success_ids),
        "success": success_ids,
        "skipped": skipped,
    }


@router.post("/{tid}/submit", response_model=TransactionOut)
async def submit_transaction(
    tid: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_can_write),
) -> TransactionOut:
    t = await db.get(Transaction, tid)
    if not t or t.deleted_at is not None:
        raise HTTPException(404, "not_found")
    await ensure_project_access(db, user, t.project_id)
    if t.status not in (TxnStatus.DRAFT, TxnStatus.REJECTED):
        raise HTTPException(409, "invalid_state")
    before = snapshot(t)
    t.status = TxnStatus.SUBMITTED
    await log(db, user_id=user.id, entity="transaction", entity_id=t.id,
              action=AuditAction.UPDATE, before=before, after=snapshot(t),
              note="submitted")
    await db.commit()
    # Notif multi-channel (Telegram + WhatsApp), best-effort.
    from app.services.messaging import notify_transaction_submitted
    await notify_transaction_submitted(db, t, actor_id=user.id)
    res = await db.execute(
        select(Transaction).options(selectinload(Transaction.attachments), selectinload(Transaction.items), selectinload(Transaction.settlement)).where(Transaction.id == t.id)
    )
    return await _serialize_with_allocs(db, res.scalar_one())


@router.post("/{tid}/verify", response_model=TransactionOut)
async def verify_transaction(
    tid: int,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> TransactionOut:
    t = await db.get(Transaction, tid)
    if not t or t.deleted_at is not None:
        raise HTTPException(404, "not_found")
    if t.status not in (TxnStatus.SUBMITTED, TxnStatus.DRAFT):
        raise HTTPException(409, "invalid_state")
    before = snapshot(t)
    t.status = TxnStatus.VERIFIED
    t.verified_by_id = admin.id
    t.verified_at = datetime.now(timezone.utc)
    if t.invoice_id:
        inv = await db.get(Invoice, t.invoice_id)
        if inv:
            await recompute_invoice_status(db, inv)
    await log(db, user_id=admin.id, entity="transaction", entity_id=t.id,
              action=AuditAction.VERIFY, before=before, after=snapshot(t))
    await db.commit()
    from app.services.messaging import notify_transaction_verified
    await notify_transaction_verified(db, t, actor_id=admin.id)
    res = await db.execute(
        select(Transaction).options(selectinload(Transaction.attachments), selectinload(Transaction.items), selectinload(Transaction.settlement)).where(Transaction.id == t.id)
    )
    return await _serialize_with_allocs(db, res.scalar_one())


@router.post("/{tid}/reject", response_model=TransactionOut)
async def reject_transaction(
    tid: int,
    body: CancelIn,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> TransactionOut:
    t = await db.get(Transaction, tid)
    if not t or t.deleted_at is not None:
        raise HTTPException(404, "not_found")
    if t.status != TxnStatus.SUBMITTED:
        raise HTTPException(409, "invalid_state")
    before = snapshot(t)
    t.status = TxnStatus.REJECTED
    t.cancel_reason = body.reason
    await log(db, user_id=admin.id, entity="transaction", entity_id=t.id,
              action=AuditAction.UPDATE, before=before, after=snapshot(t), note="rejected")
    await db.commit()
    from app.services.messaging import notify_transaction_rejected
    await notify_transaction_rejected(db, t, actor_id=admin.id)
    res = await db.execute(
        select(Transaction).options(selectinload(Transaction.attachments), selectinload(Transaction.items), selectinload(Transaction.settlement)).where(Transaction.id == t.id)
    )
    return await _serialize_with_allocs(db, res.scalar_one())


@router.post("/{tid}/cancel", response_model=TransactionOut)
async def cancel_transaction(
    tid: int,
    body: CancelIn,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> TransactionOut:
    t = await db.get(Transaction, tid)
    if not t or t.deleted_at is not None:
        raise HTTPException(404, "not_found")
    before = snapshot(t)
    t.status = TxnStatus.CANCELLED
    t.cancel_reason = body.reason
    if t.invoice_id:
        inv = await db.get(Invoice, t.invoice_id)
        if inv:
            await recompute_invoice_status(db, inv)
    # Audit 2026-05-22 #H4: reverse-link ke CashRequest.
    # Kalau tx ini adalah disbursement dari CashRequest yg di-approve,
    # update CR status ke DISBURSEMENT_CANCELLED (final state per user
    # Q5 decision). CR tdk kembali ke PENDING -- kalau perlu pengajuan
    # ulang, requester buat CR baru. Konsistensi: cegah data drift
    # 'CR=APPROVED tapi disbursement_tx=CANCELLED'.
    cr_linked = (await db.execute(
        select(CashRequest).where(CashRequest.disbursement_tx_id == t.id)
    )).scalar_one_or_none()
    if cr_linked is not None and cr_linked.status == CashRequestStatus.APPROVED.value:
        cr_before = snapshot(cr_linked)
        cr_linked.status = CashRequestStatus.DISBURSEMENT_CANCELLED.value
        await log(
            db, user_id=admin.id, entity="cash_request",
            entity_id=cr_linked.id, action=AuditAction.UPDATE,
            before=cr_before, after=snapshot(cr_linked),
            note=f"Auto-update: tx pencairan #{t.id} di-cancel ({body.reason})",
        )
    await log(db, user_id=admin.id, entity="transaction", entity_id=t.id,
              action=AuditAction.CANCEL, before=before, after=snapshot(t), note=body.reason)
    await db.commit()
    from app.services.messaging import notify_transaction_cancelled
    await notify_transaction_cancelled(db, t, actor_id=admin.id)
    res = await db.execute(
        select(Transaction).options(selectinload(Transaction.attachments), selectinload(Transaction.items), selectinload(Transaction.settlement)).where(Transaction.id == t.id)
    )
    return await _serialize_with_allocs(db, res.scalar_one())


@router.delete("/{tid}", status_code=204)
async def delete_transaction(
    tid: int,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> None:
    t = await db.get(Transaction, tid)
    if not t or t.deleted_at is not None:
        raise HTTPException(404, "not_found")
    if t.status == TxnStatus.VERIFIED:
        raise HTTPException(409, "verified_must_be_cancelled")
    before = snapshot(t)
    t.deleted_at = datetime.utcnow()
    await log(db, user_id=admin.id, entity="transaction", entity_id=t.id,
              action=AuditAction.DELETE, before=before)
    await db.commit()


@router.delete("/{tid}/hard", status_code=204)
async def hard_delete_transaction(
    tid: int,
    db: AsyncSession = Depends(get_db),
    god: User = Depends(require_superadmin),
) -> None:
    """GOD-MODE: hapus permanen transaksi + lampiran. Bypass status apa pun.
    Cuma SUPERADMIN."""
    t = await db.get(Transaction, tid)
    if not t:
        raise HTTPException(404, "not_found")
    before = snapshot(t)

    # Cabut semua alokasi yang menunjuk ke transaksi ini, lalu recompute
    # status invoice yang terdampak agar konsisten.
    alloc_res = await db.execute(
        select(InvoiceAllocation).where(InvoiceAllocation.transaction_id == tid)
    )
    affected_inv_ids: set[int] = set()
    for a in alloc_res.scalars().all():
        affected_inv_ids.add(a.invoice_id)
        await db.delete(a)

    inv_id_legacy = t.invoice_id
    await db.delete(t)  # cascade attachments via cascade="all,delete-orphan"
    await log(db, user_id=god.id, entity="transaction", entity_id=tid,
              action=AuditAction.DELETE, before=before,
              note=f"HARD DELETE (god-mode), {len(affected_inv_ids)} invoice direcompute")
    for iid in affected_inv_ids:
        inv = await db.get(Invoice, iid)
        if inv:
            await recompute_invoice_status(db, inv)
    if inv_id_legacy and inv_id_legacy not in affected_inv_ids:
        inv = await db.get(Invoice, inv_id_legacy)
        if inv:
            await recompute_invoice_status(db, inv)
    await db.commit()


@router.post("/{tid}/attachments", response_model=AttachmentOut, status_code=201)
async def upload_attachment(
    tid: int,
    file: Annotated[UploadFile, File(...)],
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_can_write),
) -> AttachmentOut:
    t = await db.get(Transaction, tid)
    if not t or t.deleted_at is not None:
        raise HTTPException(404, "not_found")
    await ensure_project_access(db, user, t.project_id)
    # VERIFIED: hanya SUPERADMIN yang boleh modifikasi (god-mode).
    # Audit 2026-05-24: relax utk VERIFIED tx yg BELUM PUNYA lampiran
    # sama sekali -- admin biasa boleh upload bukti supaya audit trail
    # tetap lengkap. Append-only, tdk overwrite/delete data existing.
    # Punya lampiran + VERIFIED -> tetap locked (cegah modifikasi bukti).
    if t.status == TxnStatus.VERIFIED and user.role != UserRole.SUPERADMIN:
        existing = (await db.execute(
            select(func.count(TransactionAttachment.id))
            .where(TransactionAttachment.transaction_id == t.id)
        )).scalar_one() or 0
        if existing > 0:
            raise HTTPException(409, "verified_locked")
    meta = await save_upload(file, subdir=f"transactions/{t.id}")
    att = TransactionAttachment(transaction_id=t.id, uploaded_by_id=user.id, **meta)
    db.add(att)
    await log(db, user_id=user.id, entity="transaction_attachment", entity_id=t.id,
              action=AuditAction.CREATE, after={"file": meta["file_name"], "url": meta["url"]})
    await db.commit()
    await db.refresh(att)
    return AttachmentOut.model_validate(att)


@router.post("/{tid}/attachments/link", response_model=AttachmentOut, status_code=201)
async def attach_external_link(
    tid: int,
    body: ExternalLinkIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_can_write),
) -> AttachmentOut:
    """Lampirkan link eksternal (Google Drive, Dropbox, dll) sebagai bukti."""
    t = await db.get(Transaction, tid)
    if not t or t.deleted_at is not None:
        raise HTTPException(404, "not_found")
    await ensure_project_access(db, user, t.project_id)
    # VERIFIED: hanya SUPERADMIN yang boleh modifikasi (god-mode).
    # Audit 2026-05-24: relax utk VERIFIED tx yg BELUM PUNYA lampiran
    # sama sekali -- admin biasa boleh upload bukti supaya audit trail
    # tetap lengkap. Punya lampiran + VERIFIED -> tetap locked.
    if t.status == TxnStatus.VERIFIED and user.role != UserRole.SUPERADMIN:
        existing = (await db.execute(
            select(func.count(TransactionAttachment.id))
            .where(TransactionAttachment.transaction_id == t.id)
        )).scalar_one() or 0
        if existing > 0:
            raise HTTPException(409, "verified_locked")
    meta = normalize_external_link(body.url, label=body.label, file_name=body.file_name)
    att = TransactionAttachment(transaction_id=t.id, uploaded_by_id=user.id, **meta)
    db.add(att)
    await log(db, user_id=user.id, entity="transaction_attachment", entity_id=t.id,
              action=AuditAction.CREATE, after={"link": meta["file_name"], "url": meta["url"]})
    await db.commit()
    await db.refresh(att)
    return AttachmentOut.model_validate(att)


@router.delete("/{tid}/attachments/{aid}", status_code=204)
async def delete_attachment(
    tid: int, aid: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_can_write),
) -> None:
    t = await db.get(Transaction, tid)
    if not t or t.deleted_at is not None:
        raise HTTPException(404, "not_found")
    await ensure_project_access(db, user, t.project_id)
    # VERIFIED: hanya SUPERADMIN yang boleh modifikasi (god-mode).
    # Audit trail keuangan harus kuat -- CENTRAL_ADMIN tidak boleh
    # ubah transaksi/lampiran yang sudah tervalidasi. Untuk koreksi,
    # gunakan workflow CANCEL (POST /:id/cancel) lalu buat ulang.
    if t.status == TxnStatus.VERIFIED and user.role != UserRole.SUPERADMIN:
        raise HTTPException(409, "verified_locked")
    att = await db.get(TransactionAttachment, aid)
    if not att or att.transaction_id != tid:
        raise HTTPException(404, "not_found")
    await db.delete(att)
    await log(db, user_id=user.id, entity="transaction_attachment", entity_id=tid,
              action=AuditAction.DELETE, before={"file": att.file_name})
    await db.commit()


# ============================================================
# Cash Advance: settlement workflow + outstanding balance reports
# ============================================================
@router.post("/{tid}/settle", response_model=CashAdvanceSettlementOut, status_code=201)
async def settle_cash_advance(
    tid: int,
    payload: CashAdvanceSettlementIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_can_write),
) -> CashAdvanceSettlementOut:
    """Pertanggungjawaban uang muka -- attach rincian penggunaan.

    Aturan:
    - Tx hrs kind=CASH_ADVANCE
    - 1 advance = max 1 settlement (idempoten)
    - sum(items) + returned_to_kas hrs >= advance.amount. Kalau >, sistem
      auto-create top-up tx (kind=DIRECT_EXPENSE, status=DRAFT, parent=advance)
      utk selisih -- bukti karyawan kelebihan bayar.
    - Kalau ==, settle full.
    - Kalau <, error 'must_match' (sisa hrs returned_to_kas).
    """
    from datetime import datetime as _dt
    from decimal import Decimal as _D
    # Audit 2026-05-22 #H8: cegah race condition concurrent settle req.
    # Lock baris transaction-nya dgn SELECT ... FOR UPDATE supaya dua
    # request paralel ter-serialize (req kedua tunggu req pertama commit,
    # lalu lihat existing settlement -> 409 already_settled).
    # SKIP_LOCKED tdk dipakai -- kita mau wait, bukan skip. SQLite tdk
    # support FOR UPDATE -- dialect.name check supaya dev SQLite tdk
    # crash (SQLite single-writer, no concurrent settle race anyway).
    is_pg = db.bind.dialect.name == "postgresql" if db.bind else False
    lock_stmt = select(Transaction).where(Transaction.id == tid)
    if is_pg:
        lock_stmt = lock_stmt.with_for_update()
    t = (await db.execute(lock_stmt)).scalar_one_or_none()
    if not t or t.deleted_at is not None:
        raise HTTPException(404, "not_found")
    await ensure_project_access(db, user, t.project_id)
    if t.kind != TxnKind.CASH_ADVANCE:
        raise HTTPException(400, "not_cash_advance: tx ini bukan uang muka")
    # Cek sudah ada settlement -- sekarang aman thd race krn row tx
    # ter-lock.
    existing = (await db.execute(
        select(CashAdvanceSettlement).where(
            CashAdvanceSettlement.cash_advance_tx_id == tid
        )
    )).scalar_one_or_none()
    if existing:
        raise HTTPException(409, "already_settled")
    if not payload.items:
        raise HTTPException(400, "items_required: minimal 1 rincian")
    items_sum = sum((_D(i.amount) for i in payload.items), start=_D("0"))
    returned = _D(payload.returned_to_kas or 0)
    if returned < 0:
        raise HTTPException(400, "returned_to_kas_negative: tdk boleh negatif")
    advance_amt = _D(t.amount or 0)
    total_accounted = items_sum + returned
    topup_tx_id: int | None = None
    topup_amount: _D | None = None
    if total_accounted < advance_amt:
        raise HTTPException(
            400,
            f"must_match: sum(items)+returned={total_accounted} < "
            f"advance={advance_amt}. Sisa hrs dikembalikan via returned_to_kas.",
        )
    if total_accounted > advance_amt:
        # Auto top-up: tx OUT kind=DIRECT_EXPENSE utk selisih.
        topup_amount = total_accounted - advance_amt
        topup = Transaction(
            project_id=t.project_id,
            tx_date=(payload.settled_at or _dt.utcnow()).date()
                if payload.settled_at else _dt.utcnow().date(),
            type=TxnType.OUT,
            kind=TxnKind.DIRECT_EXPENSE,
            amount=topup_amount,
            description=f"Top-up settlement advance #{t.id}",
            status=TxnStatus.DRAFT,
            created_by_id=user.id,
            parent_advance_tx_id=t.id,
        )
        db.add(topup)
        await db.flush()
        # Single item utk topup tx (kategori = item terbesar)
        biggest = max(payload.items, key=lambda i: _D(i.amount))
        db.add(TransactionItem(
            transaction_id=topup.id,
            category_id=biggest.category_id,
            description=f"Selisih pertanggungjawaban: {biggest.description}",
            amount=topup_amount,
        ))
        topup_tx_id = topup.id

    settlement = CashAdvanceSettlement(
        cash_advance_tx_id=tid,
        settled_at=payload.settled_at or _dt.utcnow(),
        settled_by_id=user.id,
        returned_to_kas=returned,
        topup_tx_id=topup_tx_id,
        notes=payload.notes,
    )
    db.add(settlement)
    await db.flush()
    # Pre-fetch invoice yg di-refer di items (validasi exist + recompute later)
    invoice_ids = sorted({i.invoice_id for i in payload.items if i.invoice_id})
    invoice_map: dict[int, Invoice] = {}
    if invoice_ids:
        res = await db.execute(
            select(Invoice).where(
                Invoice.id.in_(invoice_ids),
                Invoice.deleted_at.is_(None),
            )
        )
        for inv in res.scalars().all():
            invoice_map[inv.id] = inv
        # Validasi semua invoice_id ada
        missing = set(invoice_ids) - set(invoice_map.keys())
        if missing:
            raise HTTPException(
                400,
                f"invoice_id_invalid: {sorted(missing)} tidak ada / sudah dihapus",
            )
        # Aturan akunting: dana operasional 1 proyek tdk boleh dipakai
        # bayar invoice proyek lain. Validate semua invoice di proyek
        # yg sama dgn advance tx.
        wrong_project = [
            inv_id for inv_id, inv in invoice_map.items()
            if inv.project_id != t.project_id
        ]
        if wrong_project:
            raise HTTPException(
                400,
                f"invoice_wrong_project: invoice {sorted(wrong_project)} "
                f"bukan dari proyek yg sama dgn dana operasional "
                f"(proyek #{t.project_id}). Dana ops hanya boleh bayar "
                f"invoice di proyek-nya sendiri.",
            )
    for it in payload.items:
        item_row = CashAdvanceSettlementItem(
            settlement_id=settlement.id,
            category_id=it.category_id,
            description=it.description,
            amount=it.amount,
            receipt_url=it.receipt_url,
            invoice_id=it.invoice_id,
        )
        db.add(item_row)
        # Kalau item ini bayar invoice, bikin InvoiceAllocation dari tx
        # CASH_ADVANCE asli ke invoice. Recompute invoice status nanti.
        if it.invoice_id:
            db.add(InvoiceAllocation(
                invoice_id=it.invoice_id,
                transaction_id=tid,
                allocated_amount=_D(it.amount),
                note=f"Settlement dana ops #{settlement.id} -- {it.description}",
                created_by_id=user.id,
            ))
    # Recompute status semua invoice yg ke-allocate
    for inv in invoice_map.values():
        await recompute_invoice_status(db, inv)
    await log(
        db, user_id=user.id, entity="cash_advance_settlement",
        entity_id=settlement.id, action=AuditAction.CREATE,
        after={
            "cash_advance_tx_id": tid,
            "items_count": len(payload.items),
            "items_sum": str(items_sum),
            "returned_to_kas": str(returned),
            "topup_tx_id": topup_tx_id,
            "topup_amount": str(topup_amount) if topup_amount else None,
        },
    )
    await db.commit()
    # Reload + serialize
    await db.refresh(settlement)
    res = await db.execute(
        select(CashAdvanceSettlement)
        .options(selectinload(CashAdvanceSettlement.items))
        .where(CashAdvanceSettlement.id == settlement.id)
    )
    s = res.scalar_one()
    out = CashAdvanceSettlementOut.model_validate(s)
    # Resolve invoice_number per item utk display FE
    inv_ids = sorted({i.invoice_id for i in s.items if i.invoice_id})
    if inv_ids:
        inv_res = await db.execute(
            select(Invoice).where(Invoice.id.in_(inv_ids))
        )
        inv_num_map = {inv.id: inv.number for inv in inv_res.scalars().all()}
        for oi in out.items:
            if oi.invoice_id:
                oi.invoice_number = inv_num_map.get(oi.invoice_id)
    settler = await db.get(User, s.settled_by_id)
    if settler:
        out.settled_by_name = settler.name
    out.topup_amount = topup_amount
    return out


@router.delete("/{tid}/settle", status_code=204)
async def delete_cash_advance_settlement(
    tid: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_can_write),
) -> None:
    """Hapus settlement (utk koreksi). Top-up tx (kalau ada) ikut hilang
    (FK constraint -- handle manual)."""
    t = await db.get(Transaction, tid)
    if not t or t.deleted_at is not None:
        raise HTTPException(404, "not_found")
    if t.kind != TxnKind.CASH_ADVANCE:
        raise HTTPException(400, "not_cash_advance")
    settlement = (await db.execute(
        select(CashAdvanceSettlement).where(
            CashAdvanceSettlement.cash_advance_tx_id == tid
        )
    )).scalar_one_or_none()
    if not settlement:
        raise HTTPException(404, "settlement_not_found")
    # VERIFIED dilarang kecuali superadmin (audit lock)
    if t.status == TxnStatus.VERIFIED and user.role != UserRole.SUPERADMIN:
        raise HTTPException(409, "verified_locked")
    # Pre-fetch items utk handle invoice allocation rollback
    items_res = await db.execute(
        select(CashAdvanceSettlementItem).where(
            CashAdvanceSettlementItem.settlement_id == settlement.id
        )
    )
    items_to_clean = items_res.scalars().all()
    # InvoiceAllocation yg pernah dibuat saat settle (transaction_id = tx
    # CASH_ADVANCE asli, invoice_id = settlement_item.invoice_id) -> soft delete.
    inv_ids_touched: set[int] = set()
    for it in items_to_clean:
        if it.invoice_id:
            inv_ids_touched.add(it.invoice_id)
            res = await db.execute(
                select(InvoiceAllocation).where(
                    InvoiceAllocation.transaction_id == tid,
                    InvoiceAllocation.invoice_id == it.invoice_id,
                    InvoiceAllocation.deleted_at.is_(None),
                )
            )
            for alloc in res.scalars().all():
                alloc.deleted_at = datetime.utcnow()
    # Top-up tx kalau ada -- soft delete
    if settlement.topup_tx_id:
        topup = await db.get(Transaction, settlement.topup_tx_id)
        if topup and topup.deleted_at is None:
            topup.deleted_at = datetime.utcnow()
    settlement_id_log = settlement.id
    await db.delete(settlement)
    # Recompute status invoice yg di-affect
    for inv_id in inv_ids_touched:
        inv = await db.get(Invoice, inv_id)
        if inv:
            await recompute_invoice_status(db, inv)
    await log(
        db, user_id=user.id, entity="cash_advance_settlement",
        entity_id=settlement_id_log, action=AuditAction.DELETE,
        before={"cash_advance_tx_id": tid, "invoices_affected": list(inv_ids_touched)},
    )
    await db.commit()


@router.get("/cash-advances/outstanding", response_model=list[dict])
async def list_outstanding_cash_advances(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[dict]:
    """List tx kind=CASH_ADVANCE yg BELUM di-settle (outstanding).
    Hormat scoping user."""
    from app.core.deps import user_project_ids
    pids = await user_project_ids(db, user)
    stmt = (
        select(Transaction)
        .options(
            selectinload(Transaction.settlement),
            selectinload(Transaction.attachments),
        )
        .where(
            Transaction.deleted_at.is_(None),
            Transaction.kind == TxnKind.CASH_ADVANCE,
        )
    )
    if pids is not None:
        if not pids:
            return []
        stmt = stmt.where(Transaction.project_id.in_(pids))
    res = await db.execute(stmt.order_by(Transaction.tx_date.desc()))
    txs = res.scalars().all()
    # Filter yg outstanding (tdk ada settlement)
    outstanding = [t for t in txs if t.settlement is None]
    out: list[dict] = []
    user_cache: dict[int, str] = {}
    for t in outstanding:
        recipient = t.recipient_name or ""
        if t.recipient_user_id and not recipient:
            if t.recipient_user_id not in user_cache:
                u = await db.get(User, t.recipient_user_id)
                user_cache[t.recipient_user_id] = u.name if u else "?"
            recipient = user_cache[t.recipient_user_id]
        out.append({
            "id": t.id,
            "tx_date": t.tx_date.isoformat(),
            "project_id": t.project_id,
            "amount": str(t.amount),
            "recipient_user_id": t.recipient_user_id,
            "recipient_name": t.recipient_name,
            "recipient_display": recipient,
            "description": t.description,
            "status": t.status.value,
            "created_by_id": t.created_by_id,
            "age_days": (datetime.utcnow().date() - t.tx_date).days
                if hasattr(t.tx_date, "year") else 0,
        })
    return out


@router.get("/cash-advances/balances", response_model=list[CashAdvanceBalanceRow])
async def cash_advance_balances(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[CashAdvanceBalanceRow]:
    """Saldo uang muka outstanding per penerima (user atau nama bebas).

    Group key: recipient_user_id kalau ada, else lowercase(recipient_name).
    Outstanding = sum(advance.amount) - sum(settled items + returned).
    """
    from decimal import Decimal as _D
    from app.core.deps import user_project_ids
    pids = await user_project_ids(db, user)
    stmt = (
        select(Transaction)
        .options(
            selectinload(Transaction.settlement).selectinload(
                CashAdvanceSettlement.items
            ),
        )
        .where(
            Transaction.deleted_at.is_(None),
            Transaction.kind == TxnKind.CASH_ADVANCE,
        )
    )
    if pids is not None:
        if not pids:
            return []
        stmt = stmt.where(Transaction.project_id.in_(pids))
    res = await db.execute(stmt)
    txs = res.scalars().all()
    # Group by recipient
    groups: dict[tuple, dict] = {}
    user_names: dict[int, str] = {}
    for t in txs:
        key = (
            ("u", t.recipient_user_id) if t.recipient_user_id
            else ("n", (t.recipient_name or "").lower().strip())
        )
        if key not in groups:
            display = t.recipient_name or ""
            if t.recipient_user_id:
                if t.recipient_user_id not in user_names:
                    u = await db.get(User, t.recipient_user_id)
                    user_names[t.recipient_user_id] = u.name if u else "?"
                display = user_names[t.recipient_user_id]
            groups[key] = {
                "recipient_user_id": t.recipient_user_id,
                "recipient_name": display or "(tanpa nama)",
                "advance_total": _D("0"),
                "settled_total": _D("0"),
                "advance_count": 0,
                "unsettled_count": 0,
            }
        g = groups[key]
        g["advance_total"] += _D(t.amount or 0)
        g["advance_count"] += 1
        sett = t.settlement
        if sett:
            g["settled_total"] += _D(sett.returned_to_kas or 0) + sum(
                (_D(i.amount) for i in (sett.items or [])), start=_D("0")
            )
        else:
            g["unsettled_count"] += 1
    rows: list[CashAdvanceBalanceRow] = []
    for g in groups.values():
        outstanding = g["advance_total"] - g["settled_total"]
        rows.append(CashAdvanceBalanceRow(
            recipient_user_id=g["recipient_user_id"],
            recipient_name=g["recipient_name"],
            advance_total=g["advance_total"],
            settled_total=g["settled_total"],
            outstanding=outstanding,
            advance_count=g["advance_count"],
            unsettled_count=g["unsettled_count"],
        ))
    # Sort: outstanding terbesar dulu
    rows.sort(key=lambda r: -r.outstanding)
    return rows


@router.get("/{tid}/settlement", response_model=CashAdvanceSettlementOut)
async def get_cash_advance_settlement(
    tid: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> CashAdvanceSettlementOut:
    """Detail pertanggungjawaban utk 1 advance tx."""
    t = await db.get(Transaction, tid)
    if not t or t.deleted_at is not None:
        raise HTTPException(404, "not_found")
    await ensure_project_access(db, user, t.project_id)
    if t.kind != TxnKind.CASH_ADVANCE:
        raise HTTPException(400, "not_cash_advance")
    res = await db.execute(
        select(CashAdvanceSettlement)
        .options(selectinload(CashAdvanceSettlement.items))
        .where(CashAdvanceSettlement.cash_advance_tx_id == tid)
    )
    s = res.scalar_one_or_none()
    if not s:
        raise HTTPException(404, "settlement_not_found")
    out = CashAdvanceSettlementOut.model_validate(s)
    settler = await db.get(User, s.settled_by_id)
    if settler:
        out.settled_by_name = settler.name
    if s.topup_tx_id:
        topup = await db.get(Transaction, s.topup_tx_id)
        if topup:
            out.topup_amount = topup.amount
    return out
