from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from enum import Enum
from typing import Any

from sqlalchemy import inspect as sa_inspect
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.base import LoaderCallableStatus

from app.models.models import AuditAction, AuditLog


def _serialize(value: Any) -> Any:
    if isinstance(value, Enum):
        return value.value
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    # SQL expression (mis. func.now() yg belum di-flush) -> stringify, supaya
    # JSON serializer tdk meledak. Fallback aman.
    if hasattr(value, "compile"):
        return str(value)
    return value


def snapshot(obj: Any) -> dict[str, Any]:
    """Ambil snapshot kolom-kolom DB SAFE utk async context.

    KRITIS: tidak boleh trigger lazy-load attribute. Lazy-load di async
    session yg di-akses dari luar greenlet -> MissingGreenlet 500.
    Cara: pakai inspect().attrs[name].loaded_value -- return current value
    KALAU sudah loaded; kalau expired/unloaded, return marker '<expired>'
    daripada trigger getattr() yang akan SELECT.

    Caller yg butuh nilai lengkap (mis. setelah flush + onupdate=func.now()
    bikin updated_at expire) WAJIB call `await db.refresh(obj)` SEBELUM
    snapshot, atau capture snapshot SEBELUM operasi yg trigger autoflush.
    """
    if obj is None:
        return {}
    try:
        insp = sa_inspect(obj)
    except Exception:  # noqa: BLE001 -- defensive fallback
        # Bukan ORM object (mis. plain dataclass) -> fallback getattr.
        return {
            c.name: _serialize(getattr(obj, c.name, None))
            for c in obj.__table__.columns
        }
    out: dict[str, Any] = {}
    for col in obj.__table__.columns:
        name = col.name
        attr_state = insp.attrs.get(name) if hasattr(insp.attrs, "get") else None
        # Cek state attribute: loaded_value vs expired (NO_VALUE).
        if attr_state is not None:
            val = attr_state.loaded_value
            if val is LoaderCallableStatus.NO_VALUE:
                # Belum loaded / expired -- jangan trigger lazy-load.
                out[name] = "<expired>"
                continue
            out[name] = _serialize(val)
        else:
            # Fallback (jarang) -- coba akses lewat dict in-memory.
            out[name] = _serialize(obj.__dict__.get(name))
    return out


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
