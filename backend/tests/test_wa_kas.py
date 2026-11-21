"""Pengajuan kas lewat WA (/kas) -> Pengajuan Dana; semua pihak dikabari."""

from __future__ import annotations

from decimal import Decimal

import pytest
from sqlalchemy import select

from app.models.models import (
    CashRequest,
    CashRequestStatus,
    Transaction,
    TransactionAttachment,
    TxnStatus,
    User,
)
from app.services import wa_kas, wa_po_flow
from tests.test_wa_po_flow import (  # noqa: F401
    JPEG,
    KEUANGAN_WA,
    PENGAJU_WA,
    _seed,
    _siapkan_webhook,
    upload_dir,
)

pytestmark = pytest.mark.usefixtures("upload_dir")

BARU = "6285700002222@c.us"
TEDI = "6281388111354@c.us"
PESAN = (
    "/kas\nproyek bmj1\nvendor Tedi Yulianto Prabowo\nMaterial 11jt\n"
    "Kasbon Pekerja 70jt\nwa +62 813-8811-1354"
)


@pytest.mark.asyncio
async def test_kas_dari_nomor_baru_sampai_ditransfer(db, monkeypatch):
    from app.services.ai import llm
    from app.services.whatsapp import client as wa

    async def ai_mati(**kw):
        raise AssertionError("AI tidak boleh dipanggil")

    async def unduh(url):
        return JPEG, "image/jpeg"

    monkeypatch.setattr(llm, "_call_claude", ai_mati)
    monkeypatch.setattr(wa, "download_media", unduh)
    proyek, pengaju, keuangan, vendor = await _seed(db)
    kirim = await _siapkan_webhook(db, monkeypatch)

    # Nomor baru: ditanya nama, lalu /kas diproses.
    keluar = await kirim({"from": BARU, "fromMe": False, "body": PESAN})
    assert "Siapa nama Anda?" in keluar[0][1]
    keluar = await kirim({"from": BARU, "fromMe": False, "body": "Wawan"})
    ke_wawan = next(t for c, t in keluar if c == BARU)
    cr = (await db.execute(select(CashRequest))).scalar_one()
    k = wa_kas.kode(cr)
    assert f"Pengajuan kas *{k}* dicatat" in ke_wawan and "Rp 81.000.000" in ke_wawan
    assert cr.status == CashRequestStatus.PENDING.value and cr.project_id == proyek.id
    assert cr.penerima_nama == "Tedi Yulianto Prabowo" and cr.penerima_wa == TEDI
    assert cr.total_amount == Decimal("81000000")
    ke_keuangan = [t for c, t in keluar if c == KEUANGAN_WA]
    assert any(f"Pengajuan kas {k} menunggu persetujuan" in t for t in ke_keuangan)
    assert any("Kasbon Pekerja - Rp 70.000.000" in t for t in ke_keuangan)
    wawan = (await db.execute(select(User).where(User.whatsapp_chat_id == BARU))).scalar_one()
    assert cr.requester_id == wawan.id

    # Ringkasan pagi memuat kas yang menunggu.
    assert f"• {k} · Tedi Yulianto Prabowo · Rp 81.000.000" in await wa_po_flow.ringkasan_tagihan(
        db
    )

    # Pengaju tidak bisa menyetujui.
    keluar = await kirim({"from": BARU, "fromMe": False, "body": f"SETUJUI {k}"})
    assert "Hanya keuangan/pimpinan" in keluar[0][1]

    # Keuangan menyetujui -> pencairan DRAFT, pengaju dikabari.
    keluar = await kirim({"from": KEUANGAN_WA, "fromMe": False, "body": f"setujui {k}"})
    await db.refresh(cr)
    assert cr.status == CashRequestStatus.APPROVED.value and cr.disbursement_tx_id
    assert any(c == BARU and "disetujui oleh Rina Keuangan" in t for c, t in keluar)
    tx = await db.get(Transaction, cr.disbursement_tx_id)
    assert tx.status == TxnStatus.DRAFT and tx.recipient_name == "Tedi Yulianto Prabowo"

    # BAYAR tanpa foto -> diminta foto.
    keluar = await kirim({"from": KEUANGAN_WA, "fromMe": False, "body": f"BAYAR {k}"})
    assert "foto bukti transfer" in keluar[0][1]

    # BAYAR + foto -> kas keluar terverifikasi, Tedi & Wawan dikabari.
    terkirim_media: list[tuple] = []

    async def media(chat_id, data, mime, filename, caption=None):
        terkirim_media.append((chat_id, caption))
        return {"id": "x"}

    monkeypatch.setattr(wa, "send_media", media)
    keluar = await kirim(
        {
            "from": KEUANGAN_WA,
            "fromMe": False,
            "body": f"BAYAR {k}",
            "hasMedia": True,
            "media": {"url": "http://waha/files/bukti.jpg", "mimetype": "image/jpeg"},
        }
    )
    await db.refresh(tx)
    assert tx.status == TxnStatus.VERIFIED and tx.verified_by_id == keuangan.id
    assert (
        await db.execute(
            select(TransactionAttachment).where(TransactionAttachment.transaction_id == tx.id)
        )
    ).first() is not None
    assert any("dicatat sebagai kas keluar" in t for c, t in keluar if c == KEUANGAN_WA)
    assert any(c == BARU and "sudah ditransfer ke Tedi" in t for c, t in keluar)
    assert [c for c, _ in terkirim_media] == [TEDI]
    assert "Rp 81.000.000 sudah kami transfer" in terkirim_media[0][1]
    # Sudah ditransfer -> hilang dari ringkasan.
    assert k not in await wa_po_flow.ringkasan_tagihan(db)


@pytest.mark.asyncio
async def test_kas_ditolak_dan_dibatalkan(db, monkeypatch):
    proyek, pengaju, keuangan, vendor = await _seed(db)
    kirim = await _siapkan_webhook(db, monkeypatch)
    await kirim({"from": PENGAJU_WA, "fromMe": False, "body": "/kas\nproyek BMJ1\nSemen 5jt"})
    await kirim({"from": PENGAJU_WA, "fromMe": False, "body": "/kas\nproyek BMJ1\nPasir 2jt"})
    a, b = (await db.execute(select(CashRequest).order_by(CashRequest.id))).scalars().all()

    keluar = await kirim(
        {"from": KEUANGAN_WA, "fromMe": False, "body": f"TOLAK {wa_kas.kode(a)} dobel"}
    )
    await db.refresh(a)
    assert a.status == CashRequestStatus.REJECTED.value and a.rejection_reason == "dobel"
    assert any(c == PENGAJU_WA and "Alasan: dobel" in t for c, t in keluar)

    await kirim({"from": PENGAJU_WA, "fromMe": False, "body": f"BATAL {wa_kas.kode(b)}"})
    await db.refresh(b)
    assert b.status == CashRequestStatus.CANCELLED.value


@pytest.mark.asyncio
async def test_kas_baris_tanpa_nominal_ditolak_dengan_jelas(db, monkeypatch):
    await _seed(db)
    kirim = await _siapkan_webhook(db, monkeypatch)
    keluar = await kirim(
        {"from": PENGAJU_WA, "fromMe": False, "body": "/kas\nproyek BMJ1\nSemen 200 sak"}
    )
    assert "belum ada nominalnya" in keluar[0][1] and "- Semen 200 sak" in keluar[0][1]
    assert (await db.execute(select(CashRequest))).first() is None


@pytest.mark.asyncio
async def test_pengajuan_dari_aplikasi_juga_dikabari(db, monkeypatch):
    from datetime import date

    from app.api.v1.cash_requests import approve_cash_request, create_cash_request
    from app.api.v1.transactions import verify_transaction
    from app.schemas.cash_requests import CashRequestCreate
    from app.services import messaging
    from app.services.whatsapp import client as wa

    proyek, pengaju, keuangan, vendor = await _seed(db)
    terkirim: list[tuple[str, str]] = []

    async def teks(chat_id, t):
        terkirim.append((chat_id, t))
        return {"ok": True}

    async def aktif(_db):
        return True

    monkeypatch.setattr(messaging, "whatsapp_active", aktif)
    monkeypatch.setattr(wa, "send_text", teks)
    out = await create_cash_request(
        CashRequestCreate(
            project_id=proyek.id,
            request_date=date(2026, 11, 21),
            title="Operasional",
            items=[{"description": "Bensin", "amount": 500000}],
        ),
        db=db,
        user=pengaju,
    )
    assert any(c == KEUANGAN_WA and "menunggu persetujuan" in t for c, t in terkirim)
    terkirim.clear()
    out = await approve_cash_request(out.id, db=db, admin=keuangan)
    assert any(c == PENGAJU_WA and "disetujui oleh Rina Keuangan" in t for c, t in terkirim)
    terkirim.clear()
    await verify_transaction(out.disbursement_tx_id, db=db, admin=keuangan)
    assert any(c == PENGAJU_WA and "sudah ditransfer" in t for c, t in terkirim)
