"""Peminta material tidak perlu mendaftar: nomor tak dikenal yang mengirim /po
didaftarkan otomatis (ditanya nama), atau ditautkan ke akun bernomor sama."""

from __future__ import annotations

import pytest
from sqlalchemy import select

from app.models.models import PurchaseOrder, User, UserRole
from app.services import wa_po_flow
from tests.test_wa_po_flow import (  # noqa: F401
    KEUANGAN_WA,
    PEMASOK,
    _mock_ai,
    _seed,
    _siapkan_webhook,
    upload_dir,
)

pytestmark = pytest.mark.usefixtures("upload_dir")

BARU = "6285700001111@c.us"
PESAN_PO = (
    "/po\nSemen Tonasa 50 kg = 200 sak\nproyek BMJ1\nvendor CV Sumber Bangunan\nwa 0812-3456-7890"
)


def _ai(monkeypatch):
    _mock_ai(
        monkeypatch,
        [{"description": "Semen Tonasa 50 kg", "quantity": 200, "unit": "sak", "unit_price": None}],
    )


async def _pengguna(db, chat_id) -> User | None:
    return (
        await db.execute(select(User).where(User.whatsapp_chat_id == chat_id))
    ).scalar_one_or_none()


@pytest.mark.asyncio
async def test_nomor_baru_didaftarkan_ditanya_nama_lalu_po_diproses(db, monkeypatch):
    proyek, pengaju, keuangan, vendor = await _seed(db)
    kirim = await _siapkan_webhook(db, monkeypatch)
    _ai(monkeypatch)

    # 1. Nomor baru mengirim /po -> tidak ditolak, ditanya nama.
    keluar = await kirim({"from": BARU, "fromMe": False, "body": PESAN_PO})
    assert len(keluar) == 1 and "Siapa nama Anda?" in keluar[0][1]
    u = await _pengguna(db, BARU)
    assert u is not None and u.daftar_via_wa and u.wa_tunda == PESAN_PO
    assert u.role == UserRole.PROJECT_ADMIN and u.phone == "085700001111"
    assert (await db.execute(select(PurchaseOrder))).first() is None

    # 2. Nama tidak sah -> ditanya lagi.
    keluar = await kirim({"from": BARU, "fromMe": False, "body": "123"})
    assert "nama Anda saja" in keluar[0][1]

    # 3. Balas nama -> tersimpan, keuangan dikabari, /po tertunda diproses
    #    (padahal bukan anggota proyek BMJ1).
    keluar = await kirim({"from": BARU, "fromMe": False, "body": "tedi yulianto"})
    await db.refresh(u)
    assert u.name == "Tedi Yulianto" and u.wa_tunda is None
    ke_baru = [t for c, t in keluar if c == BARU]
    assert "Terima kasih, Tedi Yulianto" in ke_baru[0] and "Ringkasan PO" in ke_baru[0]
    assert any("Pengguna baru lewat WhatsApp" in t for c, t in keluar if c == KEUANGAN_WA)

    # 4. Konfirmasi -> PO atas nama pengguna baru, dikirim ke pemasok.
    keluar = await kirim({"from": BARU, "fromMe": False, "body": "ya"})
    po = (await db.execute(select(PurchaseOrder))).scalar_one()
    assert po.created_by_id == u.id and po.supplier_wa == PEMASOK
    assert any(c == PEMASOK for c, _ in keluar)

    # 5. Pembuat PO boleh mengurus PO-nya sendiri (AJUKAN setelah penawaran).
    await wa_po_flow.tangani_balasan_pemasok(db, PEMASOK, "SETUJU 30\n1 = 52000")
    await db.commit()
    keluar = await kirim({"from": BARU, "fromMe": False, "body": f"AJUKAN {wa_po_flow.kode(po)}"})
    assert any("diteruskan ke Rina Keuangan" in t for c, t in keluar if c == BARU)

    # 6. Akun ini tidak bisa melihat data proyek.
    keluar = await kirim({"from": BARU, "fromMe": False, "body": "/proyek"})
    assert "BMJ1" not in keluar[0][1]


@pytest.mark.asyncio
async def test_nomor_sudah_ada_di_data_pengguna_langsung_ditautkan(db, monkeypatch):
    proyek, pengaju, keuangan, vendor = await _seed(db)
    kirim = await _siapkan_webhook(db, monkeypatch)
    _ai(monkeypatch)
    pengaju.whatsapp_chat_id = None
    pengaju.phone = "0857-0000-1111"
    await db.commit()

    keluar = await kirim({"from": BARU, "fromMe": False, "body": PESAN_PO})
    await db.refresh(pengaju)
    assert pengaju.whatsapp_chat_id == BARU
    assert "Ringkasan PO" in keluar[0][1] and "Siapa nama" not in keluar[0][1]
    assert (await db.execute(select(User).where(User.daftar_via_wa.is_(True)))).first() is None


@pytest.mark.asyncio
async def test_nomor_akun_nonaktif_ditolak(db, monkeypatch):
    proyek, pengaju, keuangan, vendor = await _seed(db)
    kirim = await _siapkan_webhook(db, monkeypatch)
    pengaju.whatsapp_chat_id = None
    pengaju.phone = "085700001111"
    pengaju.is_active = False
    await db.commit()
    keluar = await kirim({"from": BARU, "fromMe": False, "body": PESAN_PO})
    assert "dinonaktifkan" in keluar[0][1]
    await db.refresh(pengaju)
    assert pengaju.whatsapp_chat_id is None


@pytest.mark.asyncio
async def test_pesan_biasa_dari_nomor_tak_dikenal_tidak_membuat_akun(db, monkeypatch):
    await _seed(db)
    kirim = await _siapkan_webhook(db, monkeypatch)
    await kirim({"from": BARU, "fromMe": False, "body": "halo"})
    await kirim({"from": BARU, "fromMe": False, "body": "/saldo"})
    assert await _pengguna(db, BARU) is None


@pytest.mark.parametrize(
    "isi",
    [
        "/po\nproyek bmj1\nvendor Tedi Yulianto Prabowo\nMaterial 11jt\nKasbon Pekerja 70jt\nwa +62 813-8811-1354",
        "/po\nproyek bmj1\nvendor Tedi Yulianto Prabowo\nMaterial 1 ls 11jt\nKasbon Pekerja 1 ls 70jt\nwa +62 813-8811-1354",
    ],
)
@pytest.mark.asyncio
async def test_pesan_lapangan_persis_terbaca_tanpa_ai(db, monkeypatch, isi):
    """Pesan nyata pengguna (format singkat bernominal). AI sengaja dibuat gagal:
    semuanya harus terbaca oleh pembaca pasti."""
    from app.services.ai import llm

    async def ai_mati(**kw):
        raise AssertionError("AI tidak boleh dipanggil untuk pesan ini")

    monkeypatch.setattr(llm, "_call_claude", ai_mati)
    proyek, pengaju, keuangan, vendor = await _seed(db)
    kirim = await _siapkan_webhook(db, monkeypatch)
    keluar = await kirim({"from": BARU, "fromMe": False, "body": isi})
    assert "Siapa nama Anda?" in keluar[0][1]
    keluar = await kirim({"from": BARU, "fromMe": False, "body": "Wawan"})
    teks = next(t for c, t in keluar if c == BARU)
    assert "Terima kasih, Wawan" in teks and "Ringkasan PO" in teks, teks
    assert "Rekonstruksi Ruas Pucuk (BMJ1)" in teks
    assert "Tedi Yulianto Prabowo" in teks
    assert "Material · 1 ls @ Rp 11.000.000" in teks
    assert "Kasbon Pekerja · 1 ls @ Rp 70.000.000" in teks
    assert "WA pemasok: 081388111354" in teks
