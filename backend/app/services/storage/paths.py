"""Resolusi path berkas upload yang aman dari traversal.

Audit 2026-06-13 #S-01. Sebelumnya empat modul melakukan hal yang sama
dengan tangan:

    rel = file_url[len("/files/"):]
    p = Path(settings.UPLOAD_DIR) / rel

Pola itu tidak menormalisasi `rel`, jadi `/files/../../etc/passwd`
resolve ke luar UPLOAD_DIR dan berkasnya ikut terbaca. Semua pemanggil
sekarang lewat `resolve_upload_path()` di modul ini.
"""

from __future__ import annotations

from pathlib import Path

from app.core.config import settings

FILES_PREFIX = "/files/"


class UnsafeUploadPath(ValueError):
    """Path yang diminta keluar dari UPLOAD_DIR (atau bukan path lokal)."""


def upload_root() -> Path:
    """UPLOAD_DIR yang sudah di-resolve (symlink & '..' dibereskan)."""
    return Path(settings.UPLOAD_DIR).resolve()


def is_local_file_url(url: str | None) -> bool:
    """True kalau `url` menunjuk ke storage lokal kita (`/files/...`)."""
    return bool(url) and url.startswith(FILES_PREFIX)


def to_relative(url: str) -> str:
    """Buang prefix `/files/` dari URL. Terima juga path relatif polos."""
    return url[len(FILES_PREFIX):] if url.startswith(FILES_PREFIX) else url


def resolve_upload_path(url_or_rel: str, *, must_exist: bool = True) -> Path:
    """Petakan `/files/<rel>` (atau `<rel>`) ke path absolut di UPLOAD_DIR.

    Menolak apa pun yang keluar dari UPLOAD_DIR setelah normalisasi --
    termasuk `..`, path absolut, dan symlink yang menunjuk keluar.

    Raises:
        UnsafeUploadPath: path keluar dari UPLOAD_DIR atau kosong.
        FileNotFoundError: `must_exist=True` tapi berkas tidak ada.
    """
    rel = to_relative(url_or_rel or "").strip()
    if not rel:
        raise UnsafeUploadPath("empty_path")
    # Path absolut ("/etc/passwd") akan menimpa basis saat di-join, jadi
    # tolak lebih dulu ketimbang mengandalkan pemeriksaan containment.
    if rel.startswith("/") or rel.startswith("\\"):
        raise UnsafeUploadPath("absolute_path_not_allowed")

    root = upload_root()
    candidate = (root / rel).resolve()

    # `is_relative_to` (3.9+) membandingkan setelah kedua sisi di-resolve,
    # jadi symlink yang menunjuk keluar UPLOAD_DIR ikut tertolak.
    if candidate != root and not candidate.is_relative_to(root):
        raise UnsafeUploadPath("path_escapes_upload_dir")

    if must_exist and not candidate.is_file():
        raise FileNotFoundError(f"local_file_not_found: {rel}")
    return candidate


def read_upload_bytes(url_or_rel: str) -> bytes:
    """Shortcut: resolve dgn aman lalu baca isinya."""
    return resolve_upload_path(url_or_rel).read_bytes()
