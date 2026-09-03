"""Guard SSRF untuk URL yang berasal dari input user.

Audit 2026-06-13 #S-02. `fetch_to_bytes()` dulu meneruskan `file_url`
apa adanya ke `httpx.get(..., follow_redirects=True)`, sehingga user
terautentikasi mana pun bisa memaksa backend menembak jaringan internal
(metadata cloud, `*.railway.internal`, WAHA di localhost).

Pendekatan: resolve hostname lebih dulu, tolak kalau ADA SATU SAJA
alamat hasil resolusi yang privat, lalu ikuti redirect secara manual
supaya tiap hop diperiksa ulang (kalau tidak, target bisa balas 302 ke
alamat internal setelah lolos pemeriksaan pertama).
"""

from __future__ import annotations

import ipaddress
import logging
import socket
from urllib.parse import urlparse

import httpx

log = logging.getLogger(__name__)

# Batas hop redirect. Cukup untuk shortener/Google Drive, tidak cukup
# untuk dipakai sebagai loop amplification.
MAX_REDIRECTS = 4


class BlockedURL(ValueError):
    """URL menunjuk ke alamat yang tidak boleh dihubungi backend."""


def _ip_is_blocked(ip: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    """Tolak semua yang bukan alamat publik routable."""
    return (
        ip.is_private  # 10/8, 172.16/12, 192.168/16, fc00::/7
        or ip.is_loopback  # 127/8, ::1
        or ip.is_link_local  # 169.254/16 -- metadata cloud AWS/GCP/Azure
        or ip.is_multicast
        or ip.is_reserved
        or ip.is_unspecified
    )


def assert_public_url(url: str) -> None:
    """Raise `BlockedURL` kalau `url` bukan http(s) publik.

    Catatan TOCTOU: antara pemeriksaan ini dan koneksi sebenarnya, DNS
    bisa berubah (DNS rebinding). Untuk menutup itu sepenuhnya perlu
    pinning IP di level socket. Di sini kita terima risikonya -- yang
    ditutup adalah kelas serangan langsung "kirim URL internal", yang
    jauh lebih mudah dieksekusi.
    """
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise BlockedURL(f"scheme_not_allowed: {parsed.scheme or '(kosong)'}")
    host = parsed.hostname
    if not host:
        raise BlockedURL("host_missing")

    try:
        infos = socket.getaddrinfo(host, parsed.port or (443 if parsed.scheme == "https" else 80))
    except socket.gaierror as e:
        raise BlockedURL(f"dns_resolve_failed: {host}") from e

    for info in infos:
        addr = info[4][0]
        try:
            ip = ipaddress.ip_address(addr)
        except ValueError:
            continue
        if _ip_is_blocked(ip):
            raise BlockedURL(f"private_address_blocked: {host} -> {addr}")


async def fetch_public_url(
    client: httpx.AsyncClient,
    url: str,
    *,
    max_redirects: int = MAX_REDIRECTS,
) -> httpx.Response:
    """GET `url` dengan pemeriksaan SSRF di setiap hop redirect.

    `client` HARUS dibuat dengan `follow_redirects=False` -- redirect
    diikuti manual di sini supaya tiap Location ikut divalidasi.
    """
    current = url
    for hop in range(max_redirects + 1):
        assert_public_url(current)
        response = await client.get(current)
        if not response.is_redirect:
            return response
        location = response.headers.get("location")
        if not location:
            return response
        # Redirect relatif -> absolutkan terhadap URL saat ini.
        current = str(response.url.join(location))
        log.info("net_guard.redirect hop=%s -> %s", hop + 1, current)
    raise BlockedURL(f"too_many_redirects: >{max_redirects}")
