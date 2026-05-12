"""Admin endpoint utk manage runtime settings (API keys, OCR engine,
Telegram bot, WhatsApp/WAHA). SUPERADMIN only.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import require_superadmin
from app.db.session import get_db
from app.models.models import AuditAction, User
from app.services.app_settings import (
    SETTING_REGISTRY,
    list_settings,
    set_setting,
)
from app.services.audit import log

router = APIRouter()


class SettingUpdateIn(BaseModel):
    """Update single setting. value=None / "" = hapus (fallback ke env)."""
    key: str
    value: str | None = None


class BulkUpdateIn(BaseModel):
    """Update beberapa setting sekaligus dari form Settings UI."""
    items: list[SettingUpdateIn]


@router.get("")
async def get_settings(
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(require_superadmin),
) -> dict:
    """List semua setting yg di-whitelist + value effective.

    Secret values di-mask (return preview '...XXXX'). Non-secret return
    plaintext.
    """
    items = await list_settings(db)
    # Group by 'group' utk render section di FE
    grouped: dict[str, list[dict]] = {}
    for it in items:
        grouped.setdefault(it["group"], []).append(it)
    return {"items": items, "grouped": grouped}


@router.patch("")
async def bulk_update(
    payload: BulkUpdateIn,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_superadmin),
) -> dict:
    """Update beberapa setting sekaligus. Validate semua key whitelist
    sebelum tulis (all-or-nothing).
    """
    invalid = [
        i.key for i in payload.items if i.key not in SETTING_REGISTRY
    ]
    if invalid:
        raise HTTPException(
            400, f"setting_not_whitelisted: {invalid}",
        )
    changes: list[dict] = []
    for it in payload.items:
        val = (it.value or "").strip() if it.value is not None else None
        # Treat empty string sbg 'hapus'
        await set_setting(db, it.key, val or None, user_id=admin.id, commit=False)
        meta = SETTING_REGISTRY[it.key]
        changes.append({
            "key": it.key,
            "group": meta["group"],
            "set": bool(val),
            "is_secret": meta["secret"],
        })
    await log(
        db, user_id=admin.id, entity="app_settings", entity_id=0,
        action=AuditAction.UPDATE,
        after={"changes": changes},
    )
    await db.commit()
    return {"updated": len(changes), "changes": changes}


@router.delete("/{key}")
async def delete_setting(
    key: str,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_superadmin),
) -> dict:
    """Hapus value (fallback ke env)."""
    if key not in SETTING_REGISTRY:
        raise HTTPException(400, "setting_not_whitelisted")
    await set_setting(db, key, None, user_id=admin.id, commit=False)
    await log(
        db, user_id=admin.id, entity="app_settings", entity_id=0,
        action=AuditAction.DELETE,
        before={"key": key},
    )
    await db.commit()
    return {"ok": True, "key": key}
