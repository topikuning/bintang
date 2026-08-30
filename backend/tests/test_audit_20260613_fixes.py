"""Regresi untuk temuan audit 2026-06-13.

Tiap test di sini mengunci satu perilaku yang SEBELUMNYA salah, supaya
perbaikannya tidak diam-diam hilang lagi:

  #S-01  path traversal lewat URL `/files/...`
  #S-02  SSRF lewat `file_url` di /ocr/extract
  #S-04  secret webhook dibaca dari env, bukan app_settings
  #S-05  lampiran bot melewati whitelist MIME
  #S-06  rate-limit login dilewati dgn X-Forwarded-For palsu
"""
from __future__ import annotations

import pytest
from fastapi import HTTPException, Request

from app.core.net_guard import BlockedURL, assert_public_url
from app.services.storage.paths import UnsafeUploadPath, resolve_upload_path


# ---------------------------------------------------------------------------
# #S-01 -- path traversal
# ---------------------------------------------------------------------------

@pytest.mark.parametrize(
    "evil",
    [
        "/files/../../etc/passwd",
        "/files/../../../etc/hosts",
        "../../etc/passwd",
        "/files/sub/../../../../etc/passwd",
        "/etc/passwd",            # path absolut
        "/files/",                # kosong setelah prefix
    ],
)
def test_resolve_upload_path_menolak_traversal(evil, tmp_path, monkeypatch):
    from app.core import config

    monkeypatch.setattr(config.settings, "UPLOAD_DIR", str(tmp_path), raising=False)
    with pytest.raises((UnsafeUploadPath, FileNotFoundError)):
        resolve_upload_path(evil)


def test_resolve_upload_path_menerima_path_wajar(tmp_path, monkeypatch):
    from app.core import config

    monkeypatch.setattr(config.settings, "UPLOAD_DIR", str(tmp_path), raising=False)
    target = tmp_path / "2026" / "06"
    target.mkdir(parents=True)
    (target / "bukti.jpg").write_bytes(b"x")

    got = resolve_upload_path("/files/2026/06/bukti.jpg")
    assert got == (target / "bukti.jpg").resolve()
    assert got.read_bytes() == b"x"


def test_resolve_upload_path_menolak_symlink_keluar(tmp_path, monkeypatch):
    """Symlink di dalam UPLOAD_DIR yang menunjuk keluar juga harus ditolak.

    Ini yang membedakan pemeriksaan berbasis `resolve()` dari sekadar
    memblokir string '..'.
    """
    from app.core import config

    outside = tmp_path / "rahasia.txt"
    outside.write_text("jangan terbaca")
    uploads = tmp_path / "uploads"
    uploads.mkdir()
    (uploads / "link.txt").symlink_to(outside)

    monkeypatch.setattr(config.settings, "UPLOAD_DIR", str(uploads), raising=False)
    with pytest.raises(UnsafeUploadPath):
        resolve_upload_path("/files/link.txt")


# ---------------------------------------------------------------------------
# #S-02 -- SSRF
# ---------------------------------------------------------------------------

@pytest.mark.parametrize(
    "blocked",
    [
        "http://127.0.0.1:8000/admin",
        "http://localhost:3000/api/sessions",   # WAHA internal
        "http://169.254.169.254/latest/meta-data/",  # metadata cloud
        "http://10.0.0.5/internal",
        "http://192.168.1.1/",
        "http://[::1]:8000/",
        "file:///etc/passwd",                   # skema bukan http(s)
        "ftp://example.com/x",
    ],
)
def test_assert_public_url_memblokir_alamat_internal(blocked):
    with pytest.raises(BlockedURL):
        assert_public_url(blocked)


def test_assert_public_url_meloloskan_host_publik():
    # example.com resolve ke alamat publik; kalau DNS mati di CI, test
    # ini akan raise BlockedURL("dns_resolve_failed") -- itu pun sinyal
    # yang benar (fail closed), jadi kita terima keduanya asal bukan
    # crash lain.
    try:
        assert_public_url("https://example.com/gambar.jpg")
    except BlockedURL as e:
        assert "dns_resolve_failed" in str(e)


# ---------------------------------------------------------------------------
# #S-05 -- whitelist MIME untuk lampiran bot
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
@pytest.mark.parametrize(
    "name,mime",
    [
        ("payload.html", "text/html"),
        ("payload.svg", "image/svg+xml"),
        ("shell.sh", "application/x-sh"),
        ("apa.exe", "application/octet-stream"),
    ],
)
async def test_save_bytes_menolak_jenis_berbahaya(name, mime, tmp_path, monkeypatch):
    from app.core import config
    from app.services.storage.local import save_bytes

    monkeypatch.setattr(config.settings, "UPLOAD_DIR", str(tmp_path), raising=False)
    with pytest.raises(HTTPException) as exc:
        await save_bytes(b"<script>alert(1)</script>", original_name=name,
                         subdir="transactions/1", mime_hint=mime)
    assert exc.value.status_code == 415


@pytest.mark.asyncio
async def test_save_bytes_mengabaikan_ekstensi_kiriman(tmp_path, monkeypatch):
    """Nama kiriman '.html' tidak boleh menentukan ekstensi tersimpan.

    Ini inti #S-05: dulu ekstensi diambil dari `original_name`, jadi PNG
    bernama 'x.html' tersimpan sbg .html dan disajikan sbg text/html.
    """
    from app.core import config
    from app.services.storage.local import save_bytes

    monkeypatch.setattr(config.settings, "UPLOAD_DIR", str(tmp_path), raising=False)
    meta = await save_bytes(b"\x89PNG\r\n\x1a\n" + b"0" * 64,
                            original_name="jahat.html", subdir="transactions/1",
                            mime_hint="image/png")
    assert meta["url"].endswith(".png"), meta["url"]
    assert ".html" not in meta["url"]


# ---------------------------------------------------------------------------
# #S-06 -- X-Forwarded-For tidak boleh dipercaya dari kiri
# ---------------------------------------------------------------------------

def _request_with_xff(xff: str, peer: str = "203.0.113.9") -> Request:
    return Request({
        "type": "http",
        "method": "POST",
        "headers": [(b"x-forwarded-for", xff.encode())],
        "client": (peer, 0),
    })


def test_client_ip_mengabaikan_entri_palsu_dari_kiri(monkeypatch):
    """Penyerang menyuntik IP acak di kiri; kunci harus tetap stabil."""
    from app.api.v1 import auth
    from app.core import config

    monkeypatch.setattr(config.settings, "TRUSTED_PROXY_HOPS", 1, raising=False)

    # Proxy kita (1 hop) menulis IP asli di posisi paling kanan.
    ip1 = auth._client_ip(_request_with_xff("1.2.3.4, 198.51.100.7"))
    ip2 = auth._client_ip(_request_with_xff("9.9.9.9, 198.51.100.7"))
    assert ip1 == ip2 == "198.51.100.7"


def test_client_ip_abaikan_header_saat_hops_nol(monkeypatch):
    from app.api.v1 import auth
    from app.core import config

    monkeypatch.setattr(config.settings, "TRUSTED_PROXY_HOPS", 0, raising=False)
    assert auth._client_ip(_request_with_xff("1.2.3.4")) == "203.0.113.9"


# ---------------------------------------------------------------------------
# #S-04 -- secret webhook dibaca dari app_settings (DB > env)
# ---------------------------------------------------------------------------

def test_whatsapp_webhook_secret_terdaftar_di_registry():
    """Kalau key ini hilang dari registry, admin tidak bisa mengisinya
    lewat UI dan webhook kembali terbuka -- persis bug #S-04."""
    from app.services.app_settings import SETTING_REGISTRY

    assert "WHATSAPP_WEBHOOK_SECRET" in SETTING_REGISTRY
    assert SETTING_REGISTRY["WHATSAPP_WEBHOOK_SECRET"]["secret"] is True
    assert "TELEGRAM_WEBHOOK_SECRET" in SETTING_REGISTRY
