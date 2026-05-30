"""Bot WA/Telegram -> PO assistant (audit 2026-05-30).

Mengubah pesan chat bebas user jadi PO DRAFT, lewat:
1. parse via AI (po_chat_parser feature)
2. resolve project_hint -> Project nyata (validasi akses user)
3. resolve vendor_hint -> VendorClient (atau biarkan as party string)
4. simpan session sementara (BotPendingPOSession) menunggu konfirmasi
5. pada balasan "ya" -> create PO DRAFT (reuse _next_po_number logic)

Tidak ada multi-turn dialog -- kalau parse gagal / project tdk ketemu,
bot reply error msg & user kirim ulang.
"""
from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import user_project_ids
from app.models.models import (
    BotPendingPOSession,
    POStatus,
    Project,
    ProjectStatus,
    PurchaseOrder,
    POItem,
    User,
    VendorClient,
)
from app.services.ai.features.po_chat_parser import parse as ai_parse


SESSION_TTL_MINUTES = 10


class BotPOError(Exception):
    """Error yg siap di-render jadi reply user-friendly."""


# ---------- Resolver ----------

async def _resolve_project(
    db: AsyncSession, user: User, hint: str | None,
) -> Project | None:
    """Match hint ke Project (code exact case-insensitive, atau name ilike).
    Scoped ke proyek yg user punya akses. AKTIF only."""
    if not hint:
        return None
    hint = hint.strip()
    pids = await user_project_ids(db, user)  # None = global, [..] = scoped
    stmt = select(Project).where(
        Project.deleted_at.is_(None),
        Project.status == ProjectStatus.AKTIF,
    )
    if pids is not None:
        if not pids:
            return None
        stmt = stmt.where(Project.id.in_(pids))
    # Coba code exact dulu (lebih spesifik), lalu name ilike (loose).
    by_code = stmt.where(Project.code.ilike(hint))
    p = (await db.execute(by_code)).scalar_one_or_none()
    if p:
        return p
    by_name = stmt.where(Project.name.ilike(f"%{hint}%"))
    return (await db.execute(by_name)).scalar_one_or_none()


async def _resolve_vendor(
    db: AsyncSession, hint: str | None,
) -> tuple[int | None, str | None]:
    """Match hint ke VendorClient master (global, tdk per-company).
    Return (vendor_client_id, vendor_name_used). Kalau tdk ketemu, return
    (None, hint) -- biarkan as party string di PO.vendor_name."""
    if not hint:
        return None, None
    hint = hint.strip()
    # Coba exact match dulu, lalu partial.
    exact = await db.execute(
        select(VendorClient).where(
            VendorClient.deleted_at.is_(None),
            VendorClient.name.ilike(hint),
        )
    )
    v = exact.scalars().first()
    if v:
        return v.id, v.name
    partial = await db.execute(
        select(VendorClient).where(
            VendorClient.deleted_at.is_(None),
            VendorClient.name.ilike(f"%{hint}%"),
        )
    )
    v = partial.scalars().first()
    if v:
        return v.id, v.name
    return None, hint


# ---------- Session helpers ----------

async def _save_session(
    db: AsyncSession, *, channel: str, chat_id: str,
    user_id: int, payload: dict,
) -> None:
    """Insert / replace session aktif utk (channel, chat_id)."""
    # Delete existing (any state, expired or not) supaya UNIQUE constraint
    # tdk collision. /po kedua = reset session.
    existing = (await db.execute(
        select(BotPendingPOSession).where(
            BotPendingPOSession.channel == channel,
            BotPendingPOSession.chat_id == chat_id,
        )
    )).scalar_one_or_none()
    if existing is not None:
        await db.delete(existing)
        await db.flush()
    row = BotPendingPOSession(
        channel=channel,
        chat_id=chat_id,
        user_id=user_id,
        payload_json=json.dumps(payload, default=str),
        expires_at=datetime.now(timezone.utc) + timedelta(minutes=SESSION_TTL_MINUTES),
    )
    db.add(row)
    await db.flush()


async def load_active_session(
    db: AsyncSession, *, channel: str, chat_id: str,
) -> BotPendingPOSession | None:
    """Ambil session aktif (belum expired) utk chat_id. None kalau tdk ada."""
    row = (await db.execute(
        select(BotPendingPOSession).where(
            BotPendingPOSession.channel == channel,
            BotPendingPOSession.chat_id == chat_id,
        )
    )).scalar_one_or_none()
    if row is None:
        return None
    if row.expires_at < datetime.now(timezone.utc):
        await db.delete(row)
        await db.flush()
        return None
    return row


async def delete_session(
    db: AsyncSession, session: BotPendingPOSession,
) -> None:
    await db.delete(session)
    await db.flush()


# ---------- High-level: parse + preview ----------

async def parse_and_save(
    db: AsyncSession, *, user: User, channel: str, chat_id: str, text: str,
) -> str:
    """Parse teks user via AI, resolve, simpan session. Return reply text
    (preview + instruksi konfirmasi). Raise BotPOError dgn pesan ramah
    kalau gagal (project tdk ketemu, items kosong, dll).
    """
    parsed = await ai_parse(db, user_id=user.id, text=text)
    items: list[dict] = parsed.get("items") or []
    if not items:
        raise BotPOError(
            "Tidak terbaca daftar item dari pesanmu. Contoh format:\n"
            "Besi 10 polos = 270 lonjor\n"
            "Wiremesh M8 bulat = 228 lembar\n"
            "proyek BMJ1\n"
            "vendor PT Sumber Besi",
        )

    project = await _resolve_project(db, user, parsed.get("project_hint"))
    if project is None:
        hint = parsed.get("project_hint")
        if hint:
            raise BotPOError(
                f"Proyek '{hint}' tidak ketemu atau kamu tidak punya akses. "
                f"Cek /proyek utk daftar proyek aktif yg bisa kamu akses.",
            )
        raise BotPOError(
            "Belum sebutkan proyeknya. Tambahkan baris seperti:\n"
            "proyek BMJ1\n"
            "atau\n"
            "proyek: Rekonstruksi Pucuk",
        )

    vendor_id, vendor_name = await _resolve_vendor(
        db, parsed.get("vendor_hint"),
    )

    payload = {
        "project_id": project.id,
        "project_code": project.code,
        "project_name": project.name,
        "company_id": project.company_id,
        "vendor_client_id": vendor_id,
        "vendor_name": vendor_name,  # string fallback kalau vendor_id None
        "items": items,
        "notes": parsed.get("notes"),
    }
    await _save_session(
        db, channel=channel, chat_id=chat_id, user_id=user.id, payload=payload,
    )
    return _format_preview(payload)


def _format_preview(payload: dict) -> str:
    items: list[dict] = payload["items"]
    total_est = Decimal("0")
    has_any_price = False
    for it in items:
        if it.get("unit_price"):
            has_any_price = True
            total_est += Decimal(str(it["unit_price"])) * Decimal(str(it.get("quantity") or 1))
    lines: list[str] = []
    lines.append("📋 *Preview PO*")
    lines.append(f"Proyek: {payload['project_name']} ({payload['project_code']})")
    vendor_label = payload["vendor_name"] or "(belum diisi)"
    if payload.get("vendor_client_id"):
        vendor_label = f"{vendor_label} ✓"
    lines.append(f"Vendor: {vendor_label}")
    lines.append(f"Items ({len(items)}):")
    for i, it in enumerate(items[:10], start=1):
        qty = it.get("quantity") or 1
        unit = it.get("unit") or ""
        price = it.get("unit_price")
        suffix = ""
        if price:
            suffix = f" @ Rp {Decimal(str(price)):,.0f}".replace(",", ".")
        lines.append(f"  {i}. {it['description']} · {qty} {unit}{suffix}".rstrip())
    if len(items) > 10:
        lines.append(f"  ... +{len(items) - 10} item lainnya")
    if has_any_price:
        lines.append(f"Estimasi total (sub): Rp {total_est:,.0f}".replace(",", "."))
    else:
        lines.append("Estimasi total: belum diisi (harga kosong)")
    if payload.get("notes"):
        lines.append(f"Catatan: {payload['notes']}")
    lines.append("")
    lines.append("Balas *ya* untuk simpan sebagai DRAFT, *batal* untuk batal.")
    return "\n".join(lines)


# ---------- High-level: confirm -> create PO ----------

async def confirm_create(
    db: AsyncSession, *, user: User, session: BotPendingPOSession,
) -> PurchaseOrder:
    """Create PO DRAFT dari session payload. Caller harus delete session
    setelah ini (atau ini auto-delete). Return PurchaseOrder yg sudah
    di-flush (ID terisi)."""
    from app.api.v1.purchase_orders import _compute_totals, _next_po_number

    payload = json.loads(session.payload_json)
    project = await db.get(Project, payload["project_id"])
    if project is None:
        raise BotPOError("Proyek tidak ditemukan (mungkin sudah dihapus).")

    po_date = datetime.now(timezone.utc).date()
    items_payload: list[dict] = payload.get("items") or []
    if not items_payload:
        raise BotPOError("Session tidak punya item -- silakan /po ulang.")

    # Retry kalau ada race UniqueViolation pada nomor.
    MAX_ATTEMPTS = 5
    last_err: Exception | None = None
    po: PurchaseOrder | None = None
    for attempt in range(MAX_ATTEMPTS):
        number = await _next_po_number(
            db, payload["company_id"], project.code, po_date,
        )
        po = PurchaseOrder(
            number=number,
            project_id=project.id,
            company_id=payload["company_id"],
            vendor_client_id=payload.get("vendor_client_id"),
            vendor_name=payload.get("vendor_name"),
            po_date=po_date,
            tax=Decimal("0"),
            discount=Decimal("0"),
            payment_terms=None,
            notes=payload.get("notes"),
            status=POStatus.DRAFT,
            created_by_id=user.id,
        )
        for it in items_payload:
            qty = Decimal(str(it.get("quantity") or 1))
            price = Decimal(str(it.get("unit_price") or 0))
            po.items.append(POItem(
                description=it["description"],
                quantity=qty,
                unit=it.get("unit"),
                unit_price=price,
                subtotal=qty * price,
            ))
        subtotal, total = _compute_totals(po.items, po.tax, po.discount)
        po.subtotal = subtotal
        po.total = total
        db.add(po)
        try:
            await db.flush()
            break
        except Exception as e:
            # IntegrityError dari UNIQUE(number). Re-loop generate ulang.
            last_err = e
            await db.rollback()
            project = await db.get(Project, payload["project_id"])
            if attempt == MAX_ATTEMPTS - 1:
                raise BotPOError(
                    "Gagal generate nomor PO unik. Coba ulang sebentar lagi.",
                ) from e
    assert po is not None
    # Hapus session setelah sukses.
    await db.delete(session)
    return po
