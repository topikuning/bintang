from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from enum import Enum
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.models import AuditAction, AuditLog


def _serialize(value: Any) -> Any:
    if isinstance(value, Enum):
        return value.value
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    return value


def snapshot(obj: Any) -> dict[str, Any]:
    if obj is None:
        return {}
    return {c.name: _serialize(getattr(obj, c.name)) for c in obj.__table__.columns}


async def log(
    db: AsyncSession,
    *,
    user_id: int | None,
    entity: str,
    entity_id: int,
    action: AuditAction,
    before: dict | None = None,
    after: dict | None = None,
    note: str | None = None,
) -> None:
    entry = AuditLog(
        user_id=user_id,
        entity=entity,
        entity_id=entity_id,
        action=action,
        before=before,
        after=after,
        note=note,
    )
    db.add(entry)
