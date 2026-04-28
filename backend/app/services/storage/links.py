"""Helper untuk lampiran berupa URL eksternal (Google Drive, Dropbox, dll).

Disimpan di kolom yang sama dengan file lokal (`url`, `file_name`, `mime_type`,
`file_size`). Konvensi pembeda:
- mime_type = "external/link"
- file_size = 0
- url       = URL absolut (https://...)

Frontend `fileUrl()` sudah tahu kalau URL absolut, langsung return apa adanya.
"""

from __future__ import annotations

from urllib.parse import urlparse

from fastapi import HTTPException

EXTERNAL_MIME = "external/link"


def normalize_external_link(
    url: str,
    label: str | None = None,
    file_name: str | None = None,
) -> dict:
    url = (url or "").strip()
    if not url:
        raise HTTPException(400, "url_required")
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise HTTPException(400, "url_must_be_http_or_https")
    if not parsed.netloc:
        raise HTTPException(400, "invalid_url")

    name = (file_name or label or "").strip()
    if not name:
        # ambil dari path / netloc
        name = parsed.path.rsplit("/", 1)[-1] or parsed.netloc
    return {
        "file_name": name[:255],
        "file_size": 0,
        "mime_type": EXTERNAL_MIME,
        "url": url,
    }
