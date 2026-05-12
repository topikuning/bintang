"""SUPERADMIN endpoint utk manage menu visibility per role.

GET /admin/role-menus    -> registry + hidden flags per role
PATCH /admin/role-menus  -> bulk set (role, menu_id, hidden)
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import require_superadmin
from app.db.session import get_db
from app.models.models import AuditAction, User, UserRole
from app.services.audit import log
from app.services.menu_policy import (
    MENU_REGISTRY,
    get_all_policies,
    set_policy,
)

router = APIRouter()


class PolicyUpdateIn(BaseModel):
    role: str  # UserRole value
    menu_id: str
    hidden: bool


class BulkUpdateIn(BaseModel):
    items: list[PolicyUpdateIn]


_NON_SUPER_ROLES = [
    UserRole.CENTRAL_ADMIN.value,
    UserRole.PROJECT_ADMIN.value,
    UserRole.EXECUTIVE.value,
]


@router.get("")
async def get_role_menus(
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(require_superadmin),
) -> dict:
    """Return registry menu + state hidden per role.

    Response shape:
      {
        registry: [{id, label, group}, ...],
        roles: ["CENTRAL_ADMIN", "PROJECT_ADMIN", "EXECUTIVE"],
        hidden: { "CENTRAL_ADMIN": ["audit-log", ...], ... }
      }
    """
    policies = await get_all_policies(db)
    hidden = {r: sorted(policies.get(r, set())) for r in _NON_SUPER_ROLES}
    return {
        "registry": MENU_REGISTRY,
        "roles": _NON_SUPER_ROLES,
        "hidden": hidden,
    }


@router.patch("")
async def update_role_menus(
    payload: BulkUpdateIn,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_superadmin),
) -> dict:
    """Bulk set hidden state. Validate role + menu_id whitelist."""
    valid_roles = set(_NON_SUPER_ROLES)
    changes: list[dict] = []
    for item in payload.items:
        if item.role not in valid_roles:
            raise HTTPException(
                400, f"role_invalid_or_protected: {item.role}",
            )
        try:
            role_enum = UserRole(item.role)
        except ValueError:
            raise HTTPException(400, f"role_invalid: {item.role}")
        try:
            await set_policy(
                db, role_enum, item.menu_id, item.hidden,
                user_id=admin.id, commit=False,
            )
        except ValueError as e:
            raise HTTPException(400, str(e)) from e
        changes.append({
            "role": item.role, "menu_id": item.menu_id, "hidden": item.hidden,
        })
    await log(
        db, user_id=admin.id, entity="role_menu_policy", entity_id=0,
        action=AuditAction.UPDATE, after={"changes": changes},
    )
    await db.commit()
    return {"updated": len(changes), "changes": changes}
