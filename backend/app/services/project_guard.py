"""Project-status guard utk operasi mutasi baru.

Audit 2026-05-24 Phase 1: lock create TX/Invoice/PO di proyek closed
(SELESAI / DIBATALKAN). DITAHAN intentionally NOT blocked -- warn-only
via FE banner (operasional pause, bukan financial freeze). SUPERADMIN
bisa bypass dgn explicit `force=True` flag (audit log tag "FORCE").

Caller pattern:
    project, forced = await assert_project_open(
        db, payload.project_id, user=user, force=force_query,
    )
    if forced:
        note = "FORCE bypass closed project"
"""
from __future__ import annotations

from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.models import Project, ProjectStatus, User, UserRole

# Status yg block create mutasi baru.
# - SELESAI: project closed, financial snapshot frozen.
# - DIBATALKAN: project cancelled, read-only audit trail.
# - MENUNGGU_PERSETUJUAN: belum approved, blm boleh ada mutasi.
# DITAHAN tidak di sini (warn-only di FE).
_CLOSED_STATUSES: tuple[ProjectStatus, ...] = (
    ProjectStatus.SELESAI,
    ProjectStatus.DIBATALKAN,
    ProjectStatus.MENUNGGU_PERSETUJUAN,
)


async def assert_project_open(
    db: AsyncSession,
    project_id: int,
    *,
    user: User,
    force: bool = False,
) -> tuple[Project, bool]:
    """Reject 409 kalau proyek closed kecuali SUPERADMIN + force=True.

    Returns: (project, forced) -- caller pakai `forced` utk tag audit
    log "FORCE bypass".
    """
    p = await db.get(Project, project_id)
    if not p or p.deleted_at is not None:
        raise HTTPException(404, "project_not_found")
    if p.status not in _CLOSED_STATUSES:
        return p, False
    # Closed: cek bypass.
    if force and user.role == UserRole.SUPERADMIN:
        return p, True
    # Reject. Detail dikirim sbg dict supaya FE bisa render banner
    # kontekstual (status + closed_at) -- bukan sekedar string.
    raise HTTPException(
        status_code=409,
        detail={
            "code": "project_closed",
            "status": p.status.value,
            "closed_at": p.updated_at.isoformat() if p.updated_at else None,
            "project_id": p.id,
            "project_name": p.name,
            "message": (
                f"Proyek {p.name} berstatus {p.status.value}. "
                f"Mutasi baru ditolak -- reopen lewat Edit Proyek dulu."
            ),
        },
    )
