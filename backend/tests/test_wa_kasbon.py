"""Kasbon/upah dalam /po: ditagih saat PO disetujui dan bisa dibayar tanpa
surat jalan; material tetap menunggu TERIMA + foto surat jalan."""

from __future__ import annotations

from decimal import Decimal

import pytest
from sqlalchemy import select

from app.models.models import Invoice, POStatus, PurchaseOrder, Transaction
from app.services import wa_po_flow
from app.services.bot_doc_photo import handle_session_reply
from app.services.bot_po_assistant import parse_and_save
from tests.test_wa_po_flow import (  # noqa: F401
    KEUANGAN_WA,
    PEMASOK,
    PENGAJU_WA,
    _media,
    _seed,
    upload_dir,
)

pytestmark = pytest.mark.usefixtures("upload_dir")


@pytest.mark.parametrize(
    ("uraian", "kasbon"),
    [
        ("Kasbon Pekerja", True),
        ("kas bon tukang", True),
        ("Upah tukang minggu 3", True),
        ("DP borongan", True),
        ("Material", False),
        ("Pasir cor", False),
        ("Semen Tonasa 50 kg", False),
    ],
)
def test_pengenal_kasbon(uraian, kasbon):
    assert wa_po_flow.adalah_kasbon(uraian) is kasbon


async def _po(db, monkeypatch, pengaju, barang: str) -> PurchaseOrder:
    from app.services.ai import llm

    async def ai_mati(**kw):
        raise AssertionError("AI tidak boleh dipanggil")

    monkeypatch.setattr(llm, "_call_claude", ai_mati)
    await parse_and_save(
        db,
        user=pengaju,
        channel="whatsapp",
        chat_id=PENGAJU_WA,
        text=f"{barang}\nproyek BMJ1\nvendor CV Sumber Bangunan\nwa 0812-3456-7890",
    )
    wa_po_flow.buka_kotak()
    await handle_session_reply(db, user=pengaju, channel="whatsapp", chat_id=PENGAJU_WA, text="ya")
    await db.commit()
    po = (await db.execute(select(PurchaseOrder))).scalar_one()
    await wa_po_flow.tangani_balasan_pemasok(db, PEMASOK, "SETUJU 30")
    await wa_po_flow.tangani_perintah(db, user=pengaju, teks=f"AJUKAN {wa_po_flow.kode(po)}")
    await db.commit()
    return po


async def _tagihan(db, po):
    return (
        (
            await db.execute(
                select(Invoice).where(Invoice.purchase_order_id == po.id).order_by(Invoice.id)
            )
        )
        .scalars()
        .all()
    )


@pytest.mark.asyncio
async def test_kasbon_dibayar_dulu_material_setelah_surat_jalan(db, monkeypatch):
    proyek, pengaju, keuangan, vendor = await _seed(db)
    po = await _po(db, monkeypatch, pengaju, "Material 11jt\nKasbon Pekerja 70jt")
    k = wa_po_flow.kode(po)

    # Disetujui -> tagihan kasbon langsung ada, jatuh tempo hari ini.
    wa_po_flow.buka_kotak()
    await wa_po_flow.tangani_perintah(db, user=keuangan, teks=f"SETUJUI {k}")
    await db.commit()
    assert po.wa_tahap == wa_po_flow.FINAL
    (ksb,) = await _tagihan(db, po)
    assert ksb.number.startswith("KSB/") and ksb.total == Decimal("70000000")
    assert ksb.due_date == wa_po_flow.hari_ini()
    kotak = wa_po_flow.isi_kotak()
    assert any(
        "Kasbon" in p.teks and "siap dibayar" in p.teks for p in kotak if p.chat_id == KEUANGAN_WA
    )
    final = next(p for p in kotak if p.chat_id == PEMASOK)
    assert (
        "Mohon kirim barang" in final.teks and "Kasbon/upah kami transfer lebih dulu" in final.teks
    )
    assert f"{k} · CV Sumber Bangunan · Rp 70.000.000" in await wa_po_flow.ringkasan_tagihan(db)

    # BAYAR sebelum barang datang: hanya kasbon yang dibayar.
    wa_po_flow.buka_kotak()
    r = await wa_po_flow.tangani_perintah(
        db, user=keuangan, teks=f"BAYAR {k}", ambil_media=_media()
    )
    await db.commit()
    assert "Rp 70.000.000" in r and "barang belum diterima" in r
    assert po.wa_tahap == wa_po_flow.FINAL
    ke_pemasok = next(p for p in wa_po_flow.isi_kotak() if p.chat_id == PEMASOK)
    assert ke_pemasok.teks.startswith("💸 Kasbon") and ke_pemasok.berkas_url

    # BAYAR lagi tanpa tagihan baru -> diminta menunggu barang.
    r = await wa_po_flow.tangani_perintah(
        db, user=keuangan, teks=f"BAYAR {k}", ambil_media=_media()
    )
    assert "tunggu barang datang" in r

    # Barang datang: tagihan hanya material.
    r = await wa_po_flow.tangani_perintah(
        db, user=pengaju, teks=f"TERIMA {k}", ambil_media=_media()
    )
    await db.commit()
    ksb, tag = await _tagihan(db, po)
    assert tag.number.startswith("TAG/") and tag.total == Decimal("11000000")
    assert [it.description for it in tag.items] == ["Material"]
    assert "Rp 11.000.000" in r

    # Bayar material -> LUNAS. Total kas keluar = 81 jt.
    wa_po_flow.buka_kotak()
    r = await wa_po_flow.tangani_perintah(
        db, user=keuangan, teks=f"BAYAR {k}", ambil_media=_media()
    )
    await db.commit()
    assert "Rp 11.000.000" in r and po.wa_tahap == wa_po_flow.LUNAS
    keluar = (
        (await db.execute(select(Transaction).where(Transaction.purchase_order_id == po.id)))
        .scalars()
        .all()
    )
    assert sum(t.amount for t in keluar) == Decimal("81000000")


@pytest.mark.asyncio
async def test_po_seluruhnya_kasbon_langsung_siap_dibayar(db, monkeypatch):
    proyek, pengaju, keuangan, vendor = await _seed(db)
    po = await _po(db, monkeypatch, pengaju, "Kasbon Pekerja 70jt\nUpah tukang 1 ls 5jt")
    k = wa_po_flow.kode(po)
    wa_po_flow.buka_kotak()
    await wa_po_flow.tangani_perintah(db, user=keuangan, teks=f"SETUJUI {k}")
    await db.commit()
    assert po.wa_tahap == wa_po_flow.DITERIMA and po.status == POStatus.FULFILLED
    final = next(p for p in wa_po_flow.isi_kotak() if p.chat_id == PEMASOK)
    assert "Mohon kirim barang" not in final.teks and "akan kami transfer" in final.teks
    # Surat jalan tidak diperlukan.
    r = await wa_po_flow.tangani_perintah(
        db, user=pengaju, teks=f"TERIMA {k}", ambil_media=_media()
    )
    assert "belum bisa diterima" in r
    r = await wa_po_flow.tangani_perintah(
        db, user=keuangan, teks=f"BAYAR {k}", ambil_media=_media()
    )
    await db.commit()
    assert "Rp 75.000.000" in r and po.wa_tahap == wa_po_flow.LUNAS


# ---------------------------------------------------------------------------
# Bukti lebih dari satu foto (album WA: keterangan hanya di salah satu foto)
# ---------------------------------------------------------------------------


async def _webhook(db, monkeypatch):
    from types import SimpleNamespace

    from app.api.v1 import whatsapp as wa_api
    from app.services.whatsapp import client as wa
    from tests.test_wa_po_flow import JPEG, _req_webhook

    async def _config(_db):
        return SimpleNamespace(whatsapp_enabled=True)

    async def _tanpa_secret(_db, _key):
        return None

    teks: list[tuple[str, str]] = []
    media: list[tuple[str, str | None]] = []

    async def kirim_teks(chat_id, t):
        teks.append((chat_id, t))
        return {"ok": True}

    async def kirim_media(chat_id, data, mime, filename, caption=None):
        media.append((chat_id, caption))
        return {"id": "x"}

    async def unduh(url):
        return JPEG, "image/jpeg"

    monkeypatch.setattr(wa, "is_enabled", lambda: True)
    monkeypatch.setattr(wa, "send_text", kirim_teks)
    monkeypatch.setattr(wa, "send_media", kirim_media)
    monkeypatch.setattr(wa, "download_media", unduh)
    monkeypatch.setattr(wa_api.messaging, "get_config", _config)
    monkeypatch.setattr(wa_api, "get_setting", _tanpa_secret)

    async def kirim(body="", foto=None):
        teks.clear()
        media.clear()
        payload = {"from": KEUANGAN_WA, "fromMe": False, "body": body}
        if foto:
            payload |= {
                "hasMedia": True,
                "media": {"url": f"http://waha/files/{foto}.jpg", "mimetype": "image/jpeg"},
            }
        await wa_api.webhook(_req_webhook(payload), x_webhook_hmac=None, db=db)
        return list(teks), list(media)

    return kirim


async def _lampiran_po(db, po):
    from app.models.models import TransactionAttachment

    res = await db.execute(
        select(TransactionAttachment)
        .join(Transaction, Transaction.id == TransactionAttachment.transaction_id)
        .where(Transaction.purchase_order_id == po.id)
    )
    return res.scalars().all()


@pytest.mark.asyncio
async def test_dua_foto_keterangan_di_foto_kedua(db, monkeypatch):
    proyek, pengaju, keuangan, vendor = await _seed(db)
    po = await _po(db, monkeypatch, pengaju, "Kasbon Pekerja 70jt")
    k = wa_po_flow.kode(po)
    await wa_po_flow.tangani_perintah(db, user=keuangan, teks=f"SETUJUI {k}")
    await db.commit()
    kirim = await _webhook(db, monkeypatch)

    # Foto 1 tanpa keterangan: diam (tidak ada pesan "belum ada transaksi").
    teks, media = await kirim(foto="bukti1")
    assert teks == [] and media == []
    # Foto 2 dengan "Bayar po18": keduanya dicatat & dikirim ke pemasok.
    teks, media = await kirim(f"Bayar po{po.id}", foto="bukti2")
    assert any("2 bukti" in t for c, t in teks if c == KEUANGAN_WA)
    assert [c for c, _ in media] == [PEMASOK, PEMASOK]
    assert len(await _lampiran_po(db, po)) == 2


@pytest.mark.asyncio
async def test_dua_foto_keterangan_di_foto_pertama(db, monkeypatch):
    proyek, pengaju, keuangan, vendor = await _seed(db)
    po = await _po(db, monkeypatch, pengaju, "Kasbon Pekerja 70jt")
    k = wa_po_flow.kode(po)
    await wa_po_flow.tangani_perintah(db, user=keuangan, teks=f"SETUJUI {k}")
    await db.commit()
    kirim = await _webhook(db, monkeypatch)

    teks, media = await kirim(f"BAYAR {k}", foto="bukti1")
    assert [c for c, _ in media] == [PEMASOK]
    # Sisa album menyusul tanpa keterangan: ikut dilampirkan & diteruskan.
    teks, media = await kirim(foto="bukti2")
    assert any("Bukti tambahan dikirim ke pemasok" in t for c, t in teks)
    assert [c for c, _ in media] == [PEMASOK]
    assert len(await _lampiran_po(db, po)) == 2


@pytest.mark.asyncio
async def test_bayar_tanpa_foto_memakai_bukti_hari_ini(db, monkeypatch):
    """Kasbon + material ditransfer sekaligus: setelah TERIMA, BAYAR tanpa foto
    memakai bukti transfer yang sama."""
    proyek, pengaju, keuangan, vendor = await _seed(db)
    po = await _po(db, monkeypatch, pengaju, "Material 11jt\nKasbon Pekerja 70jt")
    k = wa_po_flow.kode(po)
    await wa_po_flow.tangani_perintah(db, user=keuangan, teks=f"SETUJUI {k}")
    await db.commit()
    kirim = await _webhook(db, monkeypatch)
    await kirim(foto="bukti1")
    teks, _ = await kirim(f"BAYAR {k}", foto="bukti2")
    assert any("Material Rp 11.000.000 belum ditagih" in t for c, t in teks)

    await wa_po_flow.tangani_perintah(db, user=pengaju, teks=f"TERIMA {k}", ambil_media=_media())
    await db.commit()
    teks, media = await kirim(f"BAYAR {k}")
    assert any("Rp 11.000.000" in t and "2 bukti" in t for c, t in teks if c == KEUANGAN_WA)
    await db.refresh(po)
    assert po.wa_tahap == wa_po_flow.LUNAS
    keluar = (
        (await db.execute(select(Transaction).where(Transaction.purchase_order_id == po.id)))
        .scalars()
        .all()
    )
    assert sum(t.amount for t in keluar) == Decimal("81000000")
