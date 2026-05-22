from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import decode_token
from app.db.session import get_db
from app.models.models import Project, ProjectKind, ProjectUser, User, UserRole

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login", auto_error=False)


# Roles yang dianggap punya akses ke semua proyek (untuk read & operasional).
CENTRAL_ROLES = (UserRole.SUPERADMIN, UserRole.CENTRAL_ADMIN)


async def get_current_user(
    token: str | None = Depends(oauth2_scheme),
    db: AsyncSession = Depends(get_db),
) -> User:
    if not token:
        raise HTTPException(status_code=401, detail="not_authenticated")
    try:
        payload = decode_token(token)
    except ValueError:
        raise HTTPException(status_code=401, detail="invalid_token") from None
    sub = payload.get("sub")
    if not sub:
        raise HTTPException(status_code=401, detail="invalid_token")
    user = await db.get(User, int(sub))
    if not user or not user.is_active or user.deleted_at is not None:
        raise HTTPException(status_code=401, detail="user_inactive")
    # Audit 2026-05-22 #C5: server-side revocation. Kalau user logout
    # (atau super-admin force-revoke), tokens_revoked_after di-set ke
    # waktu logout. Token dgn iat sebelum/sama dgn cutoff dianggap
    # revoked. Legacy token tanpa iat (di-issued sebelum #C5) tetap
    # accepted -- tdk pecahkan session existing saat deploy.
    if user.tokens_revoked_after is not None:
        iat = payload.get("iat")
        if iat is not None:
            from datetime import datetime, timezone
            token_issued = datetime.fromtimestamp(int(iat), tz=timezone.utc)
            cutoff = user.tokens_revoked_after
            if cutoff.tzinfo is None:
                cutoff = cutoff.replace(tzinfo=timezone.utc)
            if token_issued <= cutoff:
                raise HTTPException(status_code=401, detail="token_revoked")
    return user


def require_superadmin(user: User = Depends(get_current_user)) -> User:
    """God-mode only: hard delete + cascade. Hanya SUPERADMIN."""
    if user.role != UserRole.SUPERADMIN:
        raise HTTPException(status_code=403, detail="superadmin_only")
    return user


def require_admin(user: User = Depends(get_current_user)) -> User:
    """Operasional admin pusat: SUPERADMIN atau CENTRAL_ADMIN."""
    if user.role not in CENTRAL_ROLES:
        raise HTTPException(status_code=403, detail="admin_only")
    return user


def require_can_write(user: User = Depends(get_current_user)) -> User:
    """Block role view-only (EXECUTIVE) dari endpoint write/upload."""
    if user.role == UserRole.EXECUTIVE:
        raise HTTPException(status_code=403, detail="read_only_role")
    return user


def has_global_access(user: User) -> bool:
    """User boleh akses SEMUA proyek (tidak perlu filter):
    - SUPERADMIN dan CENTRAL_ADMIN selalu
    - EXECUTIVE / PROJECT_ADMIN bila flag scope_all_projects = True
    """
    if user.role in CENTRAL_ROLES:
        return True
    if user.scope_all_projects:
        return True
    return False


async def user_project_ids(db: AsyncSession, user: User) -> list[int] | None:
    """Project IDs yang boleh diakses user (sudah exclude NON_PROJECT
    utk non-SUPERADMIN -- audit 2026-05-22 #C2/H2).

    Konvensi:
    - **None**  = SUPERADMIN (akses SEMUA proyek termasuk NON_PROJECT)
    - **[]**    = restricted user tanpa proyek yg ditugaskan (= no access)
    - **[...]** = list project_id REGULAR yang boleh diakses

    Konsekuensi: list/report endpoint yg pakai pattern
        `if pids is not None: stmt.where(X.project_id.in_(pids))`
    otomatis exclude NP utk semua role kecuali SUPERADMIN. Sebelumnya
    CENTRAL_ADMIN dapat None (=tdk filter) sehingga NP bocor ke laporan.
    """
    if user.role == UserRole.SUPERADMIN:
        return None
    # Non-SUPERADMIN: collect accessible projects, FILTER OUT NON_PROJECT.
    if user.role == UserRole.CENTRAL_ADMIN or user.scope_all_projects:
        # Akses ke semua proyek REGULAR.
        res = await db.execute(
            select(Project.id).where(
                Project.deleted_at.is_(None),
                Project.kind != ProjectKind.NON_PROJECT.value,
            )
        )
    else:
        res = await db.execute(
            select(ProjectUser.project_id)
            .join(Project, Project.id == ProjectUser.project_id)
            .where(
                ProjectUser.user_id == user.id,
                Project.deleted_at.is_(None),
                Project.kind != ProjectKind.NON_PROJECT.value,
            )
        )
    return [row[0] for row in res.all()]


async def ensure_project_access(db: AsyncSession, user: User, project_id: int) -> None:
    """Pastikan user dapat akses project. Untuk non-SUPERADMIN, NON_PROJECT
    di-treat sebagai 'tidak ada' (return 404, bukan 403, supaya tdk
    bocorkan keberadaannya -- audit 2026-05-22 #C2)."""
    if user.role == UserRole.SUPERADMIN:
        return  # god mode
    # NP secrecy: cek kind sebelum cek membership.
    p = await db.get(Project, project_id)
    if p is None or p.deleted_at is not None:
        raise HTTPException(status_code=404, detail="not_found")
    if p.kind == ProjectKind.NON_PROJECT.value:
        # 404 (bukan 403) supaya non-SUPERADMIN tdk tahu apakah project
        # tsb ada atau cuma tdk punya akses. Cegah enumeration.
        raise HTTPException(status_code=404, detail="not_found")
    if has_global_access(user):
        return
    res = await db.execute(
        select(ProjectUser.id).where(
            ProjectUser.user_id == user.id, ProjectUser.project_id == project_id
        )
    )
    if not res.first():
        raise HTTPException(status_code=403, detail="no_access_to_project")
