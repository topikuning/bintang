"""Menu visibility policy per role.

SUPERADMIN selalu lihat semua menu. Role lain (CENTRAL_ADMIN / PROJECT_ADMIN
/ EXECUTIVE) default visible -- baris di tabel RoleMenuPolicy hanya
menandakan menu yg DI-HIDE.

Cache in-memory (TTL 60s) supaya filter per request fast.
"""

from __future__ import annotations

import time
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.models import RoleMenuPolicy, UserRole

# Registry menu -- single source of truth. id stabil (string), label utk
# admin UI. group_id utk grouping di SUPERADMIN setting page.
# Path utk match dgn nav-config FE (FE pakai path sbg key juga).
MENU_REGISTRY: list[dict[str, Any]] = [
    # Beranda
    {"id": "dashboard", "label": "Dashboard / Beranda", "group": "beranda"},
    {"id": "projects", "label": "Proyek (Hub Operasional)", "group": "beranda"},
    # Operasional
    {"id": "transactions", "label": "Transaksi", "group": "operasional"},
    {"id": "cash-advances", "label": "Dana Operasional", "group": "operasional"},
    {"id": "cash-requests", "label": "Pengajuan Dana", "group": "operasional"},
    {"id": "invoices", "label": "Invoice", "group": "operasional"},
    {"id": "purchase-orders", "label": "Purchase Order", "group": "operasional"},
    {"id": "budget", "label": "Budget", "group": "operasional"},
    {"id": "non-project", "label": "Catatan Non-Proyek", "group": "operasional"},
    # Laporan
    {"id": "reports", "label": "Laporan", "group": "laporan"},
    {"id": "reports-invoice-items", "label": "Detail Invoice (Interaktif)", "group": "laporan"},
    {"id": "audit-log", "label": "Audit Log", "group": "laporan"},
    # Master
    {"id": "master-projects", "label": "Master Proyek", "group": "master"},
    {"id": "master-companies", "label": "Master Perusahaan", "group": "master"},
    {"id": "master-categories", "label": "Master Kategori", "group": "master"},
    {"id": "master-vendors-clients", "label": "Master Vendor/Klien", "group": "master"},
    # NOTE: master-funders dihapus -- pendana merge ke users (role=EXECUTIVE).
    # Kelola lewat master-users dgn filter role.
    {"id": "master-users", "label": "Master Pengguna", "group": "master"},
    # Sistem
    {"id": "imports", "label": "Import Data", "group": "sistem"},
    {"id": "ocr", "label": "Asisten OCR", "group": "sistem"},
    {"id": "settings", "label": "Pengaturan Profil", "group": "sistem"},
    {"id": "settings-system", "label": "Sistem (API Keys)", "group": "sistem"},
    {"id": "settings-role-menus", "label": "Akses Menu per Role", "group": "sistem"},
    {"id": "settings-orphan-files", "label": "File Orphan", "group": "sistem"},
    {"id": "settings-non-project", "label": "Inklusi Catatan Non-Proyek", "group": "sistem"},
    {"id": "settings-ai-prompts", "label": "Prompt AI", "group": "sistem"},
    # Admin -- audit 2026-05-23
    {"id": "admin-bulk-approval", "label": "Mass Action", "group": "admin"},
]
MENU_IDS = {m["id"] for m in MENU_REGISTRY}

# Menu yg hanya boleh dilihat SUPERADMIN, terlepas dari role_menu_policies.
# Catatan Non-Proyek = bucket pencatatan off-the-books rahasia milik
# SUPERADMIN; role lain (CENTRAL_ADMIN sekalipun) tidak boleh tahu
# keberadaannya supaya konsep "rahasia" terjaga.
SUPERADMIN_ONLY_MENU_IDS = {
    "non-project",
    "settings-non-project",
    # Audit 2026-05-24: prompt AI hanya boleh diutak-atik SUPERADMIN.
    # CENTRAL_ADMIN sekalipun tdk perlu lihat -- bukan bagian operasional.
    "settings-ai-prompts",
}

# Menu admin-only (SUPERADMIN + CENTRAL_ADMIN). PROJECT_ADMIN + EXECUTIVE
# tdk boleh lihat. Audit 2026-05-23 #bulk approval.
ADMIN_ONLY_MENU_IDS = {"admin-bulk-approval"}

# Cache: role -> set of hidden menu_ids, dgn TTL
_CACHE_TTL = 60.0
_hidden_cache: dict[UserRole, tuple[set[str], float]] = {}


def _now() -> float:
    return time.monotonic()


def _invalidate() -> None:
    _hidden_cache.clear()


async def get_hidden(db: AsyncSession, role: UserRole) -> set[str]:
    """Set menu_id yg di-HIDE utk role tsb. SUPERADMIN selalu return set()."""
    if role == UserRole.SUPERADMIN:
        return set()
    cached = _hidden_cache.get(role)
    if cached and cached[1] > _now():
        return cached[0]
    res = await db.execute(
        select(RoleMenuPolicy).where(
            RoleMenuPolicy.role == role, RoleMenuPolicy.hidden.is_(True),
        )
    )
    rows = res.scalars().all()
    s = {r.menu_id for r in rows if r.menu_id in MENU_IDS}
    _hidden_cache[role] = (s, _now() + _CACHE_TTL)
    return s


async def list_user_menus(db: AsyncSession, role: UserRole) -> list[str]:
    """List menu_id yg user (role tsb) BOLEH lihat."""
    hidden = await get_hidden(db, role)
    if role != UserRole.SUPERADMIN:
        hidden = hidden | SUPERADMIN_ONLY_MENU_IDS
    if role not in (UserRole.SUPERADMIN, UserRole.CENTRAL_ADMIN):
        hidden = hidden | ADMIN_ONLY_MENU_IDS
    return [m["id"] for m in MENU_REGISTRY if m["id"] not in hidden]


async def get_all_policies(db: AsyncSession) -> dict[str, set[str]]:
    """All hidden_map: role -> set of hidden menu_ids. Utk SUPERADMIN UI."""
    out: dict[str, set[str]] = {}
    res = await db.execute(
        select(RoleMenuPolicy).where(RoleMenuPolicy.hidden.is_(True))
    )
    for r in res.scalars().all():
        out.setdefault(r.role.value if hasattr(r.role, "value") else str(r.role), set()).add(r.menu_id)
    return out


async def set_policy(
    db: AsyncSession,
    role: UserRole,
    menu_id: str,
    hidden: bool,
    user_id: int | None = None,
    commit: bool = True,
) -> None:
    """Set hide/show utk role+menu. hidden=False -> hapus row (default visible)."""
    if role == UserRole.SUPERADMIN:
        # SUPERADMIN tidak boleh di-hide -- enforce di service layer juga.
        return
    if menu_id not in MENU_IDS:
        raise ValueError(f"menu_id_invalid: {menu_id}")
    res = await db.execute(
        select(RoleMenuPolicy).where(
            RoleMenuPolicy.role == role, RoleMenuPolicy.menu_id == menu_id,
        )
    )
    row = res.scalar_one_or_none()
    if hidden:
        if row is None:
            db.add(RoleMenuPolicy(
                role=role, menu_id=menu_id, hidden=True,
                updated_by_id=user_id,
            ))
        else:
            row.hidden = True
            row.updated_by_id = user_id
    else:
        if row is not None:
            await db.delete(row)
    if commit:
        await db.commit()
    _invalidate()


def invalidate_cache() -> None:
    _invalidate()
