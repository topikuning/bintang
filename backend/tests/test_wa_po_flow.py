"""Alur PO lewat WhatsApp (services/wa_po_flow.py), ujung ke ujung.

Pengguna /po + nomor WA pemasok -> "ya" -> pesanan ke pemasok -> pemasok
UBAH/SETUJU -> AJUKAN -> SETUJUI -> TERIMA + foto surat jalan -> tagihan ->
ringkasan pagi -> BAYAR + foto bukti -> kas keluar + bukti ke pemasok.

WhatsApp tidak dipanggil sungguhan: pesan keluar diperiksa dari "kotak"
(wa_po_flow.isi_kotak) atau dari send_text yang di-monkeypatch.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from decimal import Decimal

import pytest
from fastapi import HTTPException
from sqlalchemy import select

from app.core.config import settings
from app.core.security import hash_password
from app.models.models import (
    Company,
    Invoice,
    InvoiceAttachment,
    InvoiceStatus,
    InvoiceType,
    POStatus,
    Project,
    ProjectKind,
    ProjectStatus,
    ProjectUser,
    PurchaseOrder,
    Transaction,
    TransactionAttachment,
    TxnStatus,
    TxnType,
    User,
    UserRole,
    VendorClient,
)
from app.services import messaging, wa_po_flow
from app.services.ai import llm, rate_limit
from app.services.bot_doc_photo import handle_session_reply
from app.services.bot_po_assistant import parse_and_save
from app.services.whatsapp import client as wa
from app.services.whatsapp.phone import ambil_nomor_wa, normalisasi_wa, tampil_nomor

PEMASOK = "6281234567890@c.us"
PENGAJU_WA = "6281111111111@c.us"
KEUANGAN_WA = "6282222222222@c.us"

# Gambar JPEG 1x1 (valid untuk pengecekan MIME + pengecilan gambar).
JPEG = bytes.fromhex(
    "ffd8ffe000104a46494600010100000100010000ffdb004300080606070605080707070909080a0c140d0c0b0b0c1912130f141d1a1f1e1d1a1c1c20242e2720222c231c1c2837292c30313434341f27393d38323c2e333432"
    "ffc0000b080001000101011100ffc4001f0000010501010101010100000000000000000102030405060708090a0bffc400b5100002010303020403050504040000017d01020300041105122131410613516107227114328191a1082342b1c11552d1f02433627282090a161718191a25262728292a3435363738393a434445464748494a535455565758595a636465666768696a737475767778797a838485868788898a92939495969798999aa2a3a4a5a6a7a8a9aab2b3b4b5b6b7b8b9bac2c3c4c5c6c7c8c9cad2d3d4d5d6d7d8d9dae1e2e3e4e5e6e7e8e9eaf1f2f3f4f5f6f7f8f9faffda0008010100003f00fbfcffd9"
)


# ---------------------------------------------------------------------------
# Fungsi murni
# ---------------------------------------------------------------------------


def test_ambil_nomor_wa_dari_teks_bebas():
    nomor, sisa = ambil_nomor_wa("Semen 50 kg = 200 sak\nproyek BMJ1\nwa: 0812-3456-7890")
    assert nomor == PEMASOK
    assert "0812" not in sisa and "wa" not in sisa.lower().split()
    assert "Semen 50 kg = 200 sak" in sisa

    assert ambil_nomor_wa("vendor CV X +62 812 3456 7890")[0] == PEMASOK
    assert ambil_nomor_wa("Semen 200 sak proyek BMJ1")[0] is None
    assert normalisasi_wa("08123456789") == "628123456789@c.us"
    assert tampil_nomor(PEMASOK) == "081234567890"


@pytest.mark.parametrize(
    ("teks", "aksi", "tempo", "harga", "po_id"),
    [
        ("SETUJU 30", "setuju", 30, {}, None),
        ("setuju po12 14 hari", "setuju", 14, {}, 12),
        ("Oke, setuju tunai", "setuju", 0, {}, None),
        ("UBAH\n1 = 53.000\n2=310rb\nTEMPO 30", "ubah", 30, {1: 53000, 2: 310000}, None),
        ("ubah PO7 1=1,5jt tempo 0", "ubah", 0, {1: 1500000}, 7),
        ("TOLAK stok habis", "tolak", None, {}, None),
        ("halo pak", "tidak_dikenal", None, {}, None),
    ],
)
def test_parse_balasan_pemasok(teks, aksi, tempo, harga, po_id):
    b = wa_po_flow.parse_balasan_pemasok(teks)
    assert b.aksi == aksi
    assert b.tempo == tempo
    assert {k: int(v) for k, v in b.harga.items()} == harga
    assert b.po_id == po_id


def test_token_bukti_sah_rusak_kedaluwarsa():
    sekarang = 1_800_000_000.0
    token = wa_po_flow.token_bukti(42, berlaku_hari=1, sekarang=sekarang)
    assert wa_po_flow.baca_token_bukti(token, sekarang=sekarang + 10) == 42
    att, exp, sig = token.split(".")
    assert wa_po_flow.baca_token_bukti(f"43.{exp}.{sig}", sekarang=sekarang) is None
    assert wa_po_flow.baca_token_bukti(token, sekarang=sekarang + 2 * 86400) is None
    assert wa_po_flow.baca_token_bukti("sampah", sekarang=sekarang) is None


# ---------------------------------------------------------------------------
# Data uji
# ---------------------------------------------------------------------------


async def _seed(db):
    co = Company(name="CV Bintang")
    db.add(co)
    await db.flush()
    proyek = Project(
        code="BMJ1",
        name="Rekonstruksi Ruas Pucuk",
        company_id=co.id,
        status=ProjectStatus.AKTIF,
        kind=ProjectKind.REGULAR.value,
    )
    db.add(proyek)
    await db.flush()
    pengaju = User(
        email="lapangan@x",
        name="Andi Lapangan",
        password_hash=hash_password("x"),
        role=UserRole.PROJECT_ADMIN,
        whatsapp_chat_id=PENGAJU_WA,
    )
    keuangan = User(
        email="keuangan@x",
        name="Rina Keuangan",
        password_hash=hash_password("x"),
        role=UserRole.CENTRAL_ADMIN,
        whatsapp_chat_id=KEUANGAN_WA,
    )
    vendor = VendorClient(name="CV Sumber Bangunan")
    db.add_all([pengaju, keuangan, vendor])
    await db.flush()
    db.add(ProjectUser(project_id=proyek.id, user_id=pengaju.id))
    await db.commit()
    return proyek, pengaju, keuangan, vendor


def _mock_ai(monkeypatch, items: list[dict]):
    rate_limit.reset_all()
    struktur = {
        "items": items,
        "project_hint": "BMJ1",
        "vendor_hint": "CV Sumber Bangunan",
        "notes": None,
    }

    async def _fake_claude(**kw):
        return ("", struktur, 100, 50)

    monkeypatch.setattr(llm, "_call_claude", _fake_claude)
    monkeypatch.setattr(llm, "_resolve_model", lambda h: ("claude-haiku-4-5-20251001", "claude"))


def _media(konten: bytes = JPEG, mime: str = "image/jpeg"):
    async def ambil():
        return konten, mime

    return ambil


@pytest.fixture
def upload_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "UPLOAD_DIR", str(tmp_path))
    monkeypatch.setattr(settings, "PUBLIC_BASE_URL", "https://bintang.contoh.id")
    return tmp_path


async def _buat_po_lewat_wa(db, monkeypatch, pengaju) -> PurchaseOrder:
    """Langkah 1: /po + nomor WA pemasok -> preview -> 'ya'."""
    _mock_ai(
        monkeypatch,
        [
            {
                "description": "Semen Tonasa 50 kg",
                "quantity": 200,
                "unit": "sak",
                "unit_price": None,
            },
            {"description": "Pasir cor", "quantity": 5, "unit": "m3", "unit_price": 300000},
        ],
    )
    preview = await parse_and_save(
        db,
        user=pengaju,
        channel="whatsapp",
        chat_id=PENGAJU_WA,
        text="Semen Tonasa 50 kg = 200 sak\nPasir cor 5 m3 @300rb\nproyek BMJ1\nvendor CV Sumber Bangunan\nwa 0812-3456-7890",
    )
    assert "WA pemasok: 081234567890" in preview
    assert "kirimnya ke pemasok" in preview or "mengirimnya ke pemasok" in preview

    wa_po_flow.buka_kotak()
    balasan = await handle_session_reply(
        db, user=pengaju, channel="whatsapp", chat_id=PENGAJU_WA, text="ya"
    )
    await db.commit()
    assert "dikirim ke CV Sumber Bangunan" in balasan
    po = (await db.execute(select(PurchaseOrder))).scalar_one()
    return po


# ---------------------------------------------------------------------------
# Alur lengkap
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_alur_lengkap_po_lewat_whatsapp(db, monkeypatch, upload_dir):
    proyek, pengaju, keuangan, vendor = await _seed(db)

    # 1. Pengguna -> PO -> pesanan ke pemasok
    po = await _buat_po_lewat_wa(db, monkeypatch, pengaju)
    k = wa_po_flow.kode(po)
    assert po.supplier_wa == PEMASOK
    assert po.status == POStatus.ISSUED
    assert po.wa_tahap == wa_po_flow.MENUNGGU_PEMASOK
    kotak = wa_po_flow.isi_kotak()
    assert [p.chat_id for p in kotak] == [PEMASOK]
    assert f"Pesanan Barang {k}" in kotak[0].teks
    assert "Semen Tonasa 50 kg — 200 sak (harga belum diisi)" in kotak[0].teks

    # 2. Pemasok: SETUJU saja ditolak karena harga semen belum ada
    wa_po_flow.buka_kotak()
    r = await wa_po_flow.tangani_balasan_pemasok(db, PEMASOK, "SETUJU 30")
    assert "Harga barang nomor 1 belum ada" in r
    assert po.wa_tahap == wa_po_flow.MENUNGGU_PEMASOK

    # 2. Pemasok mengisi harga + mengubah harga pasir + tempo 30 hari
    r = await wa_po_flow.tangani_balasan_pemasok(
        db, PEMASOK, "UBAH\n1 = 52.000\n2 = 310rb\nTEMPO 30"
    )
    await db.commit()
    assert "Penawaran" in r and "tempo 30 hari" in r
    assert po.wa_tahap == wa_po_flow.MENUNGGU_PENGAJU
    assert po.tempo_days == 30
    total = Decimal(200 * 52000 + 5 * 310000)
    assert po.total == total
    ke_pengaju = wa_po_flow.isi_kotak()
    assert [p.chat_id for p in ke_pengaju] == [PENGAJU_WA]
    assert "harga diubah" in ke_pengaju[0].teks
    assert f"AJUKAN {k}" in ke_pengaju[0].teks

    # Admin belum boleh menyetujui dari aplikasi sebelum diajukan.
    from app.api.v1.purchase_orders import approve_po

    with pytest.raises(HTTPException) as e:
        await approve_po(po.id, db=db, admin=keuangan)
    assert e.value.status_code == 409

    # 3. Pengguna mengajukan
    wa_po_flow.buka_kotak()
    r = await wa_po_flow.tangani_perintah(db, user=pengaju, teks=f"AJUKAN {k}")
    await db.commit()
    assert "diteruskan ke keuangan" in r
    assert po.wa_tahap == wa_po_flow.MENUNGGU_PERSETUJUAN
    assert [p.chat_id for p in wa_po_flow.isi_kotak()] == [KEUANGAN_WA]

    # Pengaju tidak bisa menyetujui sendiri.
    r = await wa_po_flow.tangani_perintah(db, user=pengaju, teks=f"setujui {k}")
    assert "Hanya keuangan/pimpinan" in r

    # 4. Keuangan menyetujui lewat WA
    wa_po_flow.buka_kotak()
    r = await wa_po_flow.tangani_perintah(db, user=keuangan, teks=f"SETUJUI {k}")
    await db.commit()
    assert "disetujui" in r
    assert po.status == POStatus.APPROVED and po.approved_by_id == keuangan.id
    assert po.wa_tahap == wa_po_flow.FINAL
    kotak = wa_po_flow.isi_kotak()
    assert {p.chat_id for p in kotak} == {PEMASOK, PENGAJU_WA}
    assert any("DISETUJUI" in p.teks for p in kotak if p.chat_id == PEMASOK)

    # 5. Barang datang: tanpa foto -> diminta foto
    r = await wa_po_flow.tangani_perintah(db, user=pengaju, teks=f"TERIMA {k}")
    assert "foto surat jalan" in r
    wa_po_flow.buka_kotak()
    r = await wa_po_flow.tangani_perintah(
        db, user=pengaju, teks=f"terima {k}", ambil_media=_media()
    )
    await db.commit()
    assert "Surat jalan" in r and "jatuh tempo" in r
    assert po.status == POStatus.FULFILLED and po.wa_tahap == wa_po_flow.DITERIMA
    inv = (await db.execute(select(Invoice).where(Invoice.purchase_order_id == po.id))).scalar_one()
    assert inv.type == InvoiceType.IN and inv.status == InvoiceStatus.ISSUED
    assert inv.total == total
    assert inv.due_date == po.diterima_at + timedelta(days=30)
    lampiran_inv = (
        await db.execute(select(InvoiceAttachment).where(InvoiceAttachment.invoice_id == inv.id))
    ).scalar_one()
    assert (upload_dir / lampiran_inv.url.removeprefix("/files/")).exists()

    # 6. Ringkasan pagi di hari jatuh tempo memuat tagihan ini
    ringkasan = await wa_po_flow.ringkasan_tagihan(db, inv.due_date)
    assert f"• {k} · CV Sumber Bangunan" in ringkasan
    assert "*Hari ini* (1)" in ringkasan
    sehari_lewat = await wa_po_flow.ringkasan_tagihan(db, inv.due_date + timedelta(days=1))
    assert "Lewat jatuh tempo* (1)" in sehari_lewat

    # Pengaju tidak bisa mencatat pembayaran
    r = await wa_po_flow.tangani_perintah(db, user=pengaju, teks=f"BAYAR {k}", ambil_media=_media())
    assert "Hanya keuangan/pimpinan" in r

    # 7. Keuangan membayar + foto bukti
    wa_po_flow.buka_kotak()
    r = await wa_po_flow.tangani_perintah(
        db, user=keuangan, teks=f"BAYAR {k}", ambil_media=_media()
    )
    await db.commit()
    assert "dicatat sebagai kas keluar" in r
    assert po.wa_tahap == wa_po_flow.LUNAS
    tx = (
        await db.execute(select(Transaction).where(Transaction.purchase_order_id == po.id))
    ).scalar_one()
    assert tx.type == TxnType.OUT and tx.status == TxnStatus.VERIFIED and tx.amount == total
    await db.refresh(inv)
    assert inv.status == InvoiceStatus.PAID
    att = (
        await db.execute(
            select(TransactionAttachment).where(TransactionAttachment.transaction_id == tx.id)
        )
    ).scalar_one()
    kotak = wa_po_flow.isi_kotak()
    ke_pemasok = [p for p in kotak if p.chat_id == PEMASOK]
    assert len(ke_pemasok) == 1
    assert ke_pemasok[0].gambar_url.startswith("https://bintang.contoh.id/bukti/")
    token = ke_pemasok[0].gambar_url.rsplit("/", 1)[1]
    assert wa_po_flow.baca_token_bukti(token) == att.id
    assert any(p.chat_id == PENGAJU_WA for p in kotak)

    # Tautan bukti publik bisa dibuka tanpa login
    from app.api.files import serve_bukti_bayar

    resp = await serve_bukti_bayar(token, db=db)
    assert resp.media_type == "image/jpeg"
    with pytest.raises(HTTPException):
        await serve_bukti_bayar(token[:-1] + ("0" if token[-1] != "0" else "1"), db=db)

    # Sudah lunas -> tidak ada lagi di ringkasan
    assert k not in await wa_po_flow.ringkasan_tagihan(db, inv.due_date)


@pytest.mark.asyncio
async def test_kirim_kotak_gambar_gagal_jatuh_ke_teks(monkeypatch):
    terkirim: list[tuple[str, str]] = []

    async def gagal_gambar(chat_id, url, caption=None):
        return None  # WAHA Core: tidak bisa kirim gambar

    async def teks(chat_id, t):
        terkirim.append((chat_id, t))
        return {"ok": True}

    monkeypatch.setattr(wa, "send_image_url", gagal_gambar)
    monkeypatch.setattr(wa, "send_text", teks)
    wa_po_flow.buka_kotak()
    wa_po_flow._antre(PEMASOK, "Pembayaran PO1", gambar_url="https://x/bukti/1.2.3")
    await wa_po_flow.kirim_kotak()
    assert terkirim == [(PEMASOK, "Pembayaran PO1\n\nBukti transfer: https://x/bukti/1.2.3")]
    assert wa_po_flow.isi_kotak() == []


@pytest.mark.asyncio
async def test_pemasok_dua_pesanan_wajib_sertakan_kode(db, monkeypatch, upload_dir):
    proyek, pengaju, keuangan, vendor = await _seed(db)
    po1 = await _buat_po_lewat_wa(db, monkeypatch, pengaju)
    # PO kedua ke pemasok yang sama
    _mock_ai(
        monkeypatch,
        [{"description": "Besi 10", "quantity": 10, "unit": "batang", "unit_price": 90000}],
    )
    await parse_and_save(
        db,
        user=pengaju,
        channel="whatsapp",
        chat_id=PENGAJU_WA,
        text="Besi 10 = 10 batang\nproyek BMJ1\nwa 081234567890",
    )
    wa_po_flow.buka_kotak()
    await handle_session_reply(db, user=pengaju, channel="whatsapp", chat_id=PENGAJU_WA, text="ya")
    await db.commit()
    po2 = (await db.execute(select(PurchaseOrder).where(PurchaseOrder.id != po1.id))).scalar_one()

    r = await wa_po_flow.tangani_balasan_pemasok(db, PEMASOK, "SETUJU 14")
    assert "beberapa pesanan" in r and f"PO{po1.id}" in r and f"PO{po2.id}" in r

    r = await wa_po_flow.tangani_balasan_pemasok(db, PEMASOK, f"SETUJU PO{po2.id} 14")
    assert "Penawaran" in r
    assert po2.wa_tahap == wa_po_flow.MENUNGGU_PENGAJU and po2.tempo_days == 14
    assert po1.wa_tahap == wa_po_flow.MENUNGGU_PEMASOK

    # Nomor lain (bukan pemasok yang ditunggu) -> tidak ditangani
    assert await wa_po_flow.tangani_balasan_pemasok(db, "6289999999999@c.us", "SETUJU 30") is None
    # Pemasok tak tertaut mengirim "TOLAK PO.." -> bukan perintah pengguna
    assert await wa_po_flow.tangani_perintah(db, user=None, teks=f"TOLAK PO{po1.id}") is None
    r = await wa_po_flow.tangani_balasan_pemasok(db, PEMASOK, f"TOLAK PO{po1.id} stok kosong")
    assert "tidak bisa dipenuhi" in r
    assert po1.status == POStatus.CANCELLED and po1.wa_tahap == wa_po_flow.DITOLAK_PEMASOK


@pytest.mark.asyncio
async def test_setujui_dari_aplikasi_lanjutkan_alur(db, monkeypatch, upload_dir):
    proyek, pengaju, keuangan, vendor = await _seed(db)
    po = await _buat_po_lewat_wa(db, monkeypatch, pengaju)
    await wa_po_flow.tangani_balasan_pemasok(db, PEMASOK, "UBAH\n1 = 52000\nTEMPO 7")
    await wa_po_flow.tangani_perintah(db, user=pengaju, teks=f"ajukan PO{po.id}")
    await db.commit()

    async def aktif(db):
        return True

    monkeypatch.setattr(messaging, "whatsapp_active", aktif)
    terkirim: list[str] = []

    async def teks(chat_id, t):
        terkirim.append(chat_id)
        return {"ok": True}

    monkeypatch.setattr(wa, "send_text", teks)

    from app.api.v1.purchase_orders import approve_po

    out = await approve_po(po.id, db=db, admin=keuangan)
    assert out.status == POStatus.APPROVED and out.wa_tahap == wa_po_flow.FINAL
    assert set(terkirim) == {PEMASOK, PENGAJU_WA}


@pytest.mark.asyncio
async def test_ringkasan_pagi_sekali_sehari(db, monkeypatch):
    proyek, pengaju, keuangan, vendor = await _seed(db)

    async def aktif(db):
        return True

    monkeypatch.setattr(messaging, "whatsapp_active", aktif)
    terkirim: list[str] = []

    async def teks(chat_id, t):
        terkirim.append(chat_id)
        return {"ok": True}

    monkeypatch.setattr(wa, "send_text", teks)
    pagi = datetime(2026, 11, 23, 6, 30, tzinfo=wa_po_flow.WITA)
    assert await wa_po_flow.kirim_ringkasan_bila_waktunya(db, pagi) is False
    assert (
        await wa_po_flow.kirim_ringkasan_bila_waktunya(db, pagi.replace(hour=7, minute=5)) is True
    )
    assert terkirim == [KEUANGAN_WA]
    assert await wa_po_flow.kirim_ringkasan_bila_waktunya(db, pagi.replace(hour=9)) is False
    besok = pagi + timedelta(days=1, hours=1)
    assert await wa_po_flow.kirim_ringkasan_bila_waktunya(db, besok) is True
    assert terkirim == [KEUANGAN_WA, KEUANGAN_WA]


# ---------------------------------------------------------------------------
# Lewat webhook WAHA sungguhan (perutean pesan)
# ---------------------------------------------------------------------------


def _req_webhook(payload: dict):
    import json

    from starlette.requests import Request

    body = json.dumps({"event": "message", "session": "default", "payload": payload}).encode()

    async def receive():
        return {"type": "http.request", "body": body, "more_body": False}

    return Request(
        {
            "type": "http",
            "method": "POST",
            "path": "/api/v1/whatsapp/webhook",
            "headers": [(b"content-type", b"application/json")],
            "query_string": b"",
        },
        receive,
    )


@pytest.mark.asyncio
async def test_alur_lewat_webhook_whatsapp(db, monkeypatch, upload_dir):
    from types import SimpleNamespace

    from app.api.v1 import whatsapp as wa_api

    proyek, pengaju, keuangan, vendor = await _seed(db)

    async def _config(_db):
        return SimpleNamespace(whatsapp_enabled=True)

    async def _tanpa_secret(_db, _key):
        return None

    terkirim: list[tuple[str, str]] = []

    async def teks(chat_id, t):
        terkirim.append((chat_id, t))
        return {"ok": True}

    async def unduh(url):
        return JPEG, "image/jpeg"

    monkeypatch.setattr(wa, "is_enabled", lambda: True)
    monkeypatch.setattr(wa, "send_text", teks)
    monkeypatch.setattr(wa, "download_media", unduh)
    monkeypatch.setattr(wa_api.messaging, "get_config", _config)
    monkeypatch.setattr(wa_api, "get_setting", _tanpa_secret)

    async def kirim(chat_id, body, **extra):
        terkirim.clear()
        await wa_api.webhook(
            _req_webhook({"from": chat_id, "body": body, "fromMe": False, **extra}),
            x_webhook_hmac=None,
            db=db,
        )
        return list(terkirim)

    po = await _buat_po_lewat_wa(db, monkeypatch, pengaju)
    k = wa_po_flow.kode(po)

    # Pemasok (nomor tak tertaut) membalas dengan harga & tempo.
    keluar = await kirim(PEMASOK, "UBAH\n1 = 52.000\nTEMPO 30")
    assert {c for c, _ in keluar} == {PEMASOK, PENGAJU_WA}
    assert any("Penawaran pemasok" in t for c, t in keluar if c == PENGAJU_WA)

    keluar = await kirim(PENGAJU_WA, f"AJUKAN {k}")
    assert {c for c, _ in keluar} == {KEUANGAN_WA, PENGAJU_WA}

    keluar = await kirim(KEUANGAN_WA, f"SETUJUI {k}")
    assert {c for c, _ in keluar} == {PEMASOK, PENGAJU_WA, KEUANGAN_WA}

    # Foto surat jalan dengan keterangan TERIMA PO..
    keluar = await kirim(
        PENGAJU_WA,
        f"TERIMA {k}",
        hasMedia=True,
        media={"url": "http://waha/files/surat-jalan.jpg", "mimetype": "image/jpeg"},
    )
    await db.refresh(po)
    assert po.wa_tahap == wa_po_flow.DITERIMA
    assert any("Surat jalan" in t for c, t in keluar if c == PENGAJU_WA)

    # Perintah lama tetap jalan (tidak tertelan alur PO).
    keluar = await kirim(PENGAJU_WA, "/help")
    assert any("Pesan material lewat WA" in t for _, t in keluar)
