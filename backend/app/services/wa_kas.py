"""Pengajuan kas lewat WhatsApp (/kas, alias /dana) -> Pengajuan Dana (CashRequest).

Tujuan: bantuan pencatatan supaya tidak ada yang terlewat dan semua orang
tahu. Rincian pemakaian menyusul lewat pertanggungjawaban di aplikasi.

    /kas
    proyek klbrt
    penerima Tedi Yulianto Prabowo        (atau: vendor ...)
    Material 11jt
    Kasbon Pekerja 70jt
    wa 0813-8811-1354                     (opsional: nomor penerima dana)

Alur & siapa dikabari:
1. Pengaju kirim /kas -> tercatat PENDING (kode KAS12). Keuangan/pimpinan
   dikabari dan bisa langsung balas SETUJUI KAS12 / TOLAK KAS12 alasan.
2. Disetujui -> pencairan (kas keluar DRAFT) dibuat; pengaju dikabari.
3. Keuangan kirim foto bukti transfer + BAYAR KAS12 -> kas keluar
   terverifikasi; pengaju dan penerima dana (bila nomornya ada) menerima
   kabar + bukti.
Pengajuan dari aplikasi juga memicu kabar yang sama.
"""

from __future__ import annotations

import re
from datetime import UTC, datetime
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.models import (
    AuditAction,
    CashRequest,
    CashRequestItem,
    CashRequestStatus,
    Project,
    Transaction,
    TransactionAttachment,
    TxnStatus,
    User,
    UserRole,
)
from app.services import po_teks, wa_po_flow
from app.services.audit import log, snapshot
from app.services.whatsapp.phone import ambil_nomor_wa, tampil_nomor

_RE_PERINTAH = re.compile(
    r"^\s*/?(setujui|tolak|bayar|batal)\s+kas\s*#?\s*(\d+)\b[ \t]*(.*)$", re.I | re.S
)


def kode(cr: CashRequest) -> str:
    return f"KAS{cr.id}"


async def ambil(db: AsyncSession, cr_id: int) -> CashRequest | None:
    res = await db.execute(
        select(CashRequest)
        .options(selectinload(CashRequest.items))
        .where(CashRequest.id == cr_id, CashRequest.deleted_at.is_(None))
    )
    return res.scalar_one_or_none()


def _rincian(cr: CashRequest) -> list[str]:
    baris = []
    for i, it in enumerate(cr.items, start=1):
        baris.append(f"{i}. {it.description} - {wa_po_flow.rp(it.amount)}")
    return baris


async def _ringkas(db: AsyncSession, cr: CashRequest) -> list[str]:
    proyek = await db.get(Project, cr.project_id)
    pengaju = await db.get(User, cr.requester_id)
    return [
        f"No.: {cr.number}",
        f"Pengaju: {pengaju.name if pengaju else '-'}"
        + (f" - proyek {proyek.name} ({proyek.code})" if proyek else ""),
        *([f"Penerima: {cr.penerima_nama}"] if cr.penerima_nama else []),
        *([f"🏦 Transfer ke: {cr.rekening_tujuan}"] if cr.rekening_tujuan else []),
        "",
        *_rincian(cr),
        f"*Total: {wa_po_flow.rp(cr.total_amount)}*",
        *([f"Catatan: {cr.notes}"] if cr.notes else []),
    ]


# ---------------------------------------------------------------------------
# 1. Pengajuan
# ---------------------------------------------------------------------------

_CONTOH = (
    "Contoh:\n/kas\nproyek BMJ1\npenerima Tedi Yulianto\nMaterial 11jt\n"
    "Kasbon Pekerja 70jt\nbank BCA\nrekening 1234567890\natas nama Tedi Yulianto\n"
    "wa 0813-xxxx-xxxx (nomor penerima, opsional)"
)


async def ajukan(db: AsyncSession, user: User, teks: str) -> str:
    from app.api.v1.cash_requests import _next_cr_number
    from app.services.bot_doc_session import resolve_project

    if user.role == UserRole.EXECUTIVE:
        return "Akun Anda hanya bisa melihat."
    isi = teks.split("\n", 1)[1] if "\n" in teks else re.sub(r"^\s*/\w+", "", teks)
    rekening, isi = po_teks.ambil_rekening(isi)
    penerima_wa, isi = ambil_nomor_wa(isi)
    h = po_teks.baca(isi)
    if h.sisa:
        tanpa = "\n".join(f"- {b}" for _, b in h.sisa)
        return f"Baris berikut belum ada nominalnya:\n{tanpa}\n\n{_CONTOH}"
    if not h.barang:
        return f"Tulis keperluan dan nominalnya per baris.\n\n{_CONTOH}"
    if not h.proyek:
        return f"Sebutkan proyeknya, mis. *proyek BMJ1*.\n\n{_CONTOH}"
    proyek = await resolve_project(db, user, h.proyek)
    if proyek is None:
        return f"Proyek '{h.proyek}' tidak ditemukan atau Anda tidak punya akses."
    # Rekening tujuan wajib: dari pesan, atau dari data pemasok bernama sama.
    if rekening.lengkap:
        rekening_tujuan = rekening.teks(h.vendor)
    else:
        from app.models.models import VendorClient
        from app.services.bot_doc_session import resolve_vendor

        vendor_id, _ = await resolve_vendor(db, h.vendor)
        vendor = await db.get(VendorClient, vendor_id) if vendor_id else None
        rekening_tujuan = (vendor.bank_account or "").strip() if vendor is not None else ""
        if not rekening_tujuan:
            return "Cantumkan rekening tujuan transfer, mis.:\n" + po_teks.CONTOH_REKENING

    hari = wa_po_flow.hari_ini()
    judul = f"Kas {h.vendor}" if h.vendor else f"Kas {h.barang[0]['description']}"
    cr = CashRequest(
        number=await _next_cr_number(db, hari),
        project_id=proyek.id,
        requester_id=user.id,
        request_date=hari,
        title=judul[:200],
        notes=h.catatan,
        penerima_nama=(h.vendor or None),
        penerima_wa=penerima_wa,
        rekening_tujuan=rekening_tujuan,
        total_amount=sum(
            (Decimal(str(b["quantity"])) * Decimal(str(b["unit_price"])) for b in h.barang),
            Decimal("0"),
        ),
        status=CashRequestStatus.PENDING.value,
    )
    db.add(cr)
    await db.flush()
    for b in h.barang:
        jumlah = Decimal(str(b["quantity"]))
        harga = Decimal(str(b["unit_price"]))
        db.add(
            CashRequestItem(
                request_id=cr.id,
                description=b["description"][:300],
                quantity=jumlah,
                unit_price=harga,
                amount=jumlah * harga,
            )
        )
    await db.flush()
    await db.refresh(cr, attribute_names=[c.name for c in CashRequest.__table__.columns])
    await log(
        db,
        user_id=user.id,
        entity="cash_request",
        entity_id=cr.id,
        action=AuditAction.CREATE,
        after=snapshot(cr),
        note="[WA] /kas",
    )
    cr = await ambil(db, cr.id) or cr
    terkabari = await kabari_penyetuju(db, cr, user)
    k = kode(cr)
    baris = [
        f"🧾 Pengajuan kas *{k}* dicatat ({cr.number}): {wa_po_flow.rp(cr.total_amount)}.",
        *_rincian(cr),
    ]
    if user.role in wa_po_flow.PENYETUJU:
        baris.append(f"Anda juga penyetuju: balas *SETUJUI {k}* atau *TOLAK {k} alasan*.")
    if terkabari:
        baris.append(f"Diteruskan ke {', '.join(terkabari)}.")
    else:
        baris.append(
            "Belum ada keuangan/pimpinan yang menautkan WhatsApp; persetujuan lewat aplikasi."
        )
    baris.append(f"Batalkan: *BATAL {k}*. Rincian pemakaian menyusul lewat aplikasi.")
    return "\n".join(baris)


async def kabari_penyetuju(db: AsyncSession, cr: CashRequest, pengaju: User) -> list[str]:
    """Kirim permintaan persetujuan ke keuangan/pimpinan bertaut WA (kecuali
    pengaju sendiri). Return nama yang dikabari."""
    from app.services import messaging

    if not await messaging.whatsapp_active(db):
        return []
    k = kode(cr)
    teks = "\n".join(
        [
            f"💰 *Pengajuan kas {k} menunggu persetujuan*",
            *await _ringkas(db, cr),
            "",
            f"Balas *SETUJUI {k}* atau *TOLAK {k} alasan*. Bisa juga di aplikasi (Pengajuan Dana).",
        ]
    )
    lain = await wa_po_flow._penyetuju(db, kecuali_id=pengaju.id)
    for u in lain:
        wa_po_flow._antre(u.whatsapp_chat_id, teks)
    return [u.name for u in lain]


# ---------------------------------------------------------------------------
# 2. Disetujui / ditolak / batal
# ---------------------------------------------------------------------------


async def setelah_disetujui(db: AsyncSession, cr: CashRequest, admin: User) -> None:
    pengaju = await db.get(User, cr.requester_id)
    if pengaju is not None and pengaju.id != admin.id:
        wa_po_flow._antre(
            pengaju.whatsapp_chat_id,
            f"✅ Pengajuan kas {kode(cr)} ({wa_po_flow.rp(cr.total_amount)}) disetujui oleh "
            f"{admin.name}. Menunggu transfer dari keuangan.",
        )
    for u in await wa_po_flow._penyetuju(db, kecuali_id=admin.id):
        wa_po_flow._antre(
            u.whatsapp_chat_id,
            f"✅ {kode(cr)} ({wa_po_flow.rp(cr.total_amount)}) disetujui oleh {admin.name}.\n"
            + (f"🏦 Transfer ke: {cr.rekening_tujuan}\n" if cr.rekening_tujuan else "")
            + f"Setelah transfer, kirim foto bukti dengan keterangan *BAYAR {kode(cr)}*.",
        )


async def setelah_ditolak(db: AsyncSession, cr: CashRequest, admin: User) -> None:
    pengaju = await db.get(User, cr.requester_id)
    if pengaju is not None and pengaju.id != admin.id:
        wa_po_flow._antre(
            pengaju.whatsapp_chat_id,
            f"❌ Pengajuan kas {kode(cr)} ditolak oleh {admin.name}.\n"
            f"Alasan: {cr.rejection_reason or '-'}",
        )


async def _batal(db: AsyncSession, user: User, cr: CashRequest) -> str:
    if user.id != cr.requester_id and user.role not in wa_po_flow.PENYETUJU:
        return f"Hanya pengaju atau keuangan/pimpinan yang bisa membatalkan {kode(cr)}."
    if cr.status != CashRequestStatus.PENDING.value:
        return f"{kode(cr)} tidak bisa dibatalkan (status {cr.status})."
    before = snapshot(cr)
    cr.status = CashRequestStatus.CANCELLED.value
    await log(
        db,
        user_id=user.id,
        entity="cash_request",
        entity_id=cr.id,
        action=AuditAction.UPDATE,
        before=before,
        after=snapshot(cr),
        note="[WA] dibatalkan",
    )
    return f"{kode(cr)} dibatalkan."


# ---------------------------------------------------------------------------
# 3. Dana ditransfer
# ---------------------------------------------------------------------------


async def _kabari_dicairkan(
    db: AsyncSession, cr: CashRequest, aktor: User, berkas: list[dict] | dict | None
) -> None:
    daftar = berkas if isinstance(berkas, list) else ([berkas] if berkas else [])
    jumlah = wa_po_flow.rp(cr.total_amount)
    pengaju = await db.get(User, cr.requester_id)
    if pengaju is not None and pengaju.id != aktor.id:
        wa_po_flow._antre(
            pengaju.whatsapp_chat_id,
            f"💸 Kas {kode(cr)} {jumlah} sudah ditransfer"
            + (f" ke {cr.penerima_nama}" if cr.penerima_nama else "")
            + f" oleh {aktor.name}.\nRincian pemakaian/nota menyusul di aplikasi "
            "(pertanggungjawaban).",
        )
    if cr.penerima_wa:
        proyek = await db.get(Project, cr.project_id)
        teks = (
            f"💸 Dana {jumlah} sudah kami transfer"
            + (f" untuk proyek {proyek.name}" if proyek else "")
            + f" ({kode(cr)}, {wa_po_flow.tgl(wa_po_flow.hari_ini())}). Terima kasih."
        )
        if not daftar:
            wa_po_flow._antre(cr.penerima_wa, teks)
        for i, b in enumerate(daftar):
            wa_po_flow._antre(
                cr.penerima_wa,
                teks if i == 0 else f"Bukti transfer {i + 1}/{len(daftar)} ({kode(cr)}).",
                berkas=b,
            )


async def bayar(
    db: AsyncSession,
    aktor: User,
    cr: CashRequest,
    berkas: dict | list[dict],
    *,
    chat_id: str | None = None,
) -> str:
    daftar = berkas if isinstance(berkas, list) else [berkas]
    if aktor.role not in wa_po_flow.PENYETUJU:
        return "Hanya keuangan/pimpinan yang bisa mencatat pembayaran."
    if cr.status != CashRequestStatus.APPROVED.value or not cr.disbursement_tx_id:
        return f"{kode(cr)} belum disetujui (status {cr.status})."
    tx = await db.get(Transaction, cr.disbursement_tx_id)
    if tx is None or tx.deleted_at is not None:
        return f"Kas keluar untuk {kode(cr)} tidak ditemukan."
    if tx.status == TxnStatus.VERIFIED:
        return f"{kode(cr)} sudah tercatat ditransfer sebelumnya."
    before = snapshot(tx)
    tx.status = TxnStatus.VERIFIED
    tx.verified_by_id = aktor.id
    tx.verified_at = datetime.now(UTC)
    for b in daftar:
        db.add(TransactionAttachment(transaction_id=tx.id, uploaded_by_id=aktor.id, **b))
    await log(
        db,
        user_id=aktor.id,
        entity="transaction",
        entity_id=tx.id,
        action=AuditAction.VERIFY,
        before=before,
        after=snapshot(tx),
        note=f"[WA] pencairan {kode(cr)}",
    )
    await _kabari_dicairkan(db, cr, aktor, daftar)
    await wa_po_flow.buka_jendela_bukti(db, chat_id, tx.id)
    return (
        f"💸 {kode(cr)} {wa_po_flow.rp(cr.total_amount)} dicatat sebagai kas keluar"
        + (
            f"; bukti dikirim ke {cr.penerima_nama or tampil_nomor(cr.penerima_wa)}"
            if cr.penerima_wa
            else ""
        )
        + "."
    )


async def setelah_tx_diverifikasi(db: AsyncSession, tx: Transaction, aktor: User) -> None:
    """Hook verifikasi transaksi di aplikasi: bila tx ini pencairan pengajuan
    kas, kabari pengaju & penerima (bukti = lampiran terakhir tx, bila ada)."""
    res = await db.execute(
        select(CashRequest)
        .options(selectinload(CashRequest.items))
        .where(CashRequest.disbursement_tx_id == tx.id)
    )
    cr = res.scalar_one_or_none()
    if cr is None:
        return
    from app.services import messaging

    if not await messaging.whatsapp_active(db):
        return
    lampiran = (
        (
            await db.execute(
                select(TransactionAttachment)
                .where(TransactionAttachment.transaction_id == tx.id)
                .order_by(TransactionAttachment.id.desc())
            )
        )
        .scalars()
        .first()
    )
    berkas = (
        {"url": lampiran.url, "mime_type": lampiran.mime_type, "file_name": lampiran.file_name}
        if lampiran is not None and lampiran.url and not lampiran.url.startswith("http")
        else None
    )
    await _kabari_dicairkan(db, cr, aktor, berkas)


# ---------------------------------------------------------------------------
# Perintah WA: SETUJUI/TOLAK/BAYAR/BATAL KAS12
# ---------------------------------------------------------------------------


async def tangani_perintah(
    db: AsyncSession, *, user: User, teks: str, ambil_media=None, chat_id: str | None = None
) -> str | None:
    from app.services import pengajuan_dana

    m = _RE_PERINTAH.match(teks or "")
    if not m:
        return None
    aksi, cr_id, sisa = m.group(1).lower(), int(m.group(2)), (m.group(3) or "").strip()
    cr = await ambil(db, cr_id)
    if cr is None:
        return f"KAS{cr_id} tidak ditemukan."
    if aksi == "batal":
        return await _batal(db, user, cr)
    if user.role not in wa_po_flow.PENYETUJU:
        return "Hanya keuangan/pimpinan yang bisa menyetujui, menolak, atau mencatat pembayaran."
    try:
        if aksi == "setujui":
            await pengajuan_dana.setujui(db, cr, user)
            await setelah_disetujui(db, cr, user)
            return (
                f"✅ {kode(cr)} disetujui ({wa_po_flow.rp(cr.total_amount)}).\n"
                + (f"🏦 Transfer ke: {cr.rekening_tujuan}\n" if cr.rekening_tujuan else "")
                + f"Setelah transfer, kirim foto bukti dengan keterangan *BAYAR {kode(cr)}*."
            )
        if aksi == "tolak":
            await pengajuan_dana.tolak(db, cr, user, sisa or "-")
            await setelah_ditolak(db, cr, user)
            return f"{kode(cr)} ditolak. Pengaju sudah diberi tahu."
    except HTTPException:
        return f"{kode(cr)} tidak menunggu persetujuan (status {cr.status})."
    # bayar
    if cr.status != CashRequestStatus.APPROVED.value:
        return f"{kode(cr)} belum disetujui (status {cr.status})."
    berkas = await wa_po_flow.kumpulkan_foto(
        db, chat_id, ambil_media, f"transactions/kas-{cr.id}", f"bukti-{kode(cr)}.jpg"
    )
    if isinstance(berkas, str):
        return berkas
    if not berkas:
        return f"Kirim *foto bukti transfer* dengan keterangan *BAYAR {kode(cr)}*."
    return await bayar(db, user, cr, berkas, chat_id=chat_id)


# ---------------------------------------------------------------------------
# Ringkasan pagi
# ---------------------------------------------------------------------------


async def ringkasan(db: AsyncSession) -> list[str]:
    """Baris tambahan untuk ringkasan pagi: kas menunggu persetujuan / transfer."""
    res = await db.execute(
        select(CashRequest)
        .where(
            CashRequest.deleted_at.is_(None),
            CashRequest.status.in_(
                (CashRequestStatus.PENDING.value, CashRequestStatus.APPROVED.value)
            ),
        )
        .order_by(CashRequest.id)
    )
    menunggu_setuju, menunggu_transfer = [], []
    for cr in res.scalars().all():
        if cr.status == CashRequestStatus.PENDING.value:
            menunggu_setuju.append(cr)
            continue
        tx = await db.get(Transaction, cr.disbursement_tx_id) if cr.disbursement_tx_id else None
        if tx is not None and tx.status not in (TxnStatus.VERIFIED, TxnStatus.CANCELLED):
            menunggu_transfer.append(cr)
    baris: list[str] = []
    for judul, daftar in (
        ("💰 *Kas menunggu persetujuan*", menunggu_setuju),
        ("💰 *Kas disetujui, belum ditransfer*", menunggu_transfer),
    ):
        if not daftar:
            continue
        jumlah = sum((Decimal(c.total_amount or 0) for c in daftar), Decimal("0"))
        baris += ["", f"{judul} ({len(daftar)}) - {wa_po_flow.rp(jumlah)}"]
        for c in daftar:
            baris.append(
                f"• {kode(c)} · {c.penerima_nama or c.title} · {wa_po_flow.rp(c.total_amount)}"
            )
            if c.rekening_tujuan:
                baris.append(f"   🏦 {c.rekening_tujuan}")
    return baris
