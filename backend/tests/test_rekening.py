"""Rekening tujuan pembayaran wajib ada di /po dan /kas; tampil di pesan keuangan."""

from __future__ import annotations

import pytest
from sqlalchemy import select

from app.models.models import CashRequest, PurchaseOrder, VendorClient
from app.services import wa_po_flow
from app.services.bot_doc_photo import handle_session_reply
from app.services.bot_doc_session import BotDocError
from app.services.bot_po_assistant import parse_and_save
from app.services.po_teks import ambil_rekening
from tests.test_wa_po_flow import (  # noqa: F401
    KEUANGAN_WA,
    PEMASOK,
    PENGAJU_WA,
    _seed,
    _siapkan_webhook,
    upload_dir,
)

pytestmark = pytest.mark.usefixtures("upload_dir")


def test_format_form_tf_uang_dan_nomor_rekening_bukan_nomor_wa():
    rek, sisa = ambil_rekening(
        "Lokasi: Bosel\nNama Bank : SulutGo\nAtas Nama : ANDI AMRULLAH\nRekening : 03002110011516\n"
        "Jumlah : 33.200.000"
    )
    assert rek.teks() == "SulutGo 03002110011516 a.n. ANDI AMRULLAH"
    assert "Rekening" not in sisa and "Jumlah" in sisa
    # Rekening yang diawali 08 tidak boleh dianggap nomor WA.
    rek, sisa = ambil_rekening("bank BCA\nno rek 0812-3456-7890\na.n. Tedi\nwa 0857 1111 2222")
    assert rek.nomor == "0812 3456 7890" and "0812" not in sisa and "0857" in sisa


def _ai_mati(monkeypatch):
    from app.services.ai import llm

    async def mati(**kw):
        raise AssertionError("AI tidak boleh dipanggil")

    monkeypatch.setattr(llm, "_call_claude", mati)


@pytest.mark.asyncio
async def test_po_tanpa_rekening_ditolak_kecuali_ada_di_data_pemasok(db, monkeypatch):
    _ai_mati(monkeypatch)
    proyek, pengaju, keuangan, vendor = await _seed(db)
    with pytest.raises(BotDocError) as e:
        await parse_and_save(
            db,
            user=pengaju,
            channel="whatsapp",
            chat_id=PENGAJU_WA,
            text="Material 11jt\nproyek BMJ1\nvendor Toko Baru\nwa 0812-3456-7890",
        )
    assert "Cantumkan rekening tujuan pembayaran" in str(e.value)
    # Pemasok terdaftar dengan rekening: dipakai otomatis.
    r = await parse_and_save(
        db,
        user=pengaju,
        channel="whatsapp",
        chat_id=PENGAJU_WA,
        text="Material 11jt\nproyek BMJ1\nvendor CV Sumber Bangunan\nwa 0812-3456-7890",
    )
    assert "🏦 Rekening: BCA 1112223334 a.n. CV Sumber Bangunan" in r


@pytest.mark.asyncio
async def test_rekening_tampil_untuk_keuangan_dan_bisa_dikoreksi_pemasok(db, monkeypatch):
    _ai_mati(monkeypatch)
    proyek, pengaju, keuangan, vendor = await _seed(db)
    await parse_and_save(
        db,
        user=pengaju,
        channel="whatsapp",
        chat_id=PENGAJU_WA,
        text=(
            "Material 11jt\nKasbon Pekerja 70jt\nproyek BMJ1\nvendor Toko Baru Jaya\n"
            "bank BRI\nrekening 5556667778\natas nama Budi Jaya\nwa 0812-3456-7890"
        ),
    )
    wa_po_flow.buka_kotak()
    await handle_session_reply(db, user=pengaju, channel="whatsapp", chat_id=PENGAJU_WA, text="ya")
    await db.commit()
    po = (await db.execute(select(PurchaseOrder))).scalar_one()
    assert po.rekening_tujuan == "BRI 5556667778 a.n. Budi Jaya"
    ke_pemasok = next(p for p in wa_po_flow.isi_kotak() if p.chat_id == PEMASOK)
    assert "Pembayaran akan kami transfer ke: BRI 5556667778 a.n. Budi Jaya" in ke_pemasok.teks
    # Pemasok baru masuk data pemasok lengkap dengan rekeningnya.
    v = (
        await db.execute(select(VendorClient).where(VendorClient.name == "Toko Baru Jaya"))
    ).scalar_one()
    assert v.bank_account == "BRI 5556667778 a.n. Budi Jaya"

    # Pemasok mengoreksi rekening di balasannya.
    await wa_po_flow.tangani_balasan_pemasok(
        db, PEMASOK, "SETUJU 30\nbank BNI\nrekening 9998887776\natas nama Toko Baru Jaya"
    )
    await db.commit()
    assert po.rekening_tujuan == "BNI 9998887776 a.n. Toko Baru Jaya"
    assert po.tempo_days == 30

    wa_po_flow.buka_kotak()
    k = wa_po_flow.kode(po)
    await wa_po_flow.tangani_perintah(db, user=pengaju, teks=f"AJUKAN {k}")
    minta = next(p for p in wa_po_flow.isi_kotak() if p.chat_id == KEUANGAN_WA)
    assert "🏦 Transfer ke: BNI 9998887776 a.n. Toko Baru Jaya" in minta.teks
    wa_po_flow.buka_kotak()
    await wa_po_flow.tangani_perintah(db, user=keuangan, teks=f"SETUJUI {k}")
    await db.commit()
    kasbon = next(
        p for p in wa_po_flow.isi_kotak() if p.chat_id == KEUANGAN_WA and "Kasbon" in p.teks
    )
    assert "🏦 Transfer ke: BNI 9998887776" in kasbon.teks
    assert "🏦 BNI 9998887776 a.n. Toko Baru Jaya" in await wa_po_flow.ringkasan_tagihan(db)


@pytest.mark.asyncio
async def test_kas_wajib_rekening(db, monkeypatch):
    proyek, pengaju, keuangan, vendor = await _seed(db)
    kirim = await _siapkan_webhook(db, monkeypatch)
    keluar = await kirim(
        {"from": PENGAJU_WA, "fromMe": False, "body": "/kas\nproyek BMJ1\npenerima Tedi\nUpah 5jt"}
    )
    assert "Cantumkan rekening tujuan transfer" in keluar[0][1]
    assert (await db.execute(select(CashRequest))).first() is None
    # Penerima = pemasok terdaftar ber-rekening: dipakai otomatis.
    keluar = await kirim(
        {
            "from": PENGAJU_WA,
            "fromMe": False,
            "body": "/kas\nproyek BMJ1\npenerima CV Sumber Bangunan\nSemen 5jt",
        }
    )
    cr = (await db.execute(select(CashRequest))).scalar_one()
    assert cr.rekening_tujuan == "BCA 1112223334 a.n. CV Sumber Bangunan"
    assert any("🏦 Transfer ke: BCA 1112223334" in t for c, t in keluar if c == KEUANGAN_WA)
