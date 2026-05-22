from datetime import date as date_type

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user
from app.db.session import get_db
from app.models.models import (
    AuditLog,
    Invoice,
    Project,
    ProjectKind,
    PurchaseOrder,
    Transaction,
    User,
    UserRole,
)
from app.schemas.common import Page

router = APIRouter()


@router.get("")
async def list_audit_logs(
    entity: str | None = None,
    entity_id: int | None = None,
    user_id: int | None = None,
    date_from: date_type | None = None,
    date_to: date_type | None = None,
    page: int = Query(1, ge=1),
    size: int = Query(50, ge=1, le=2000),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> Page:
    if user.role not in (UserRole.SUPERADMIN, UserRole.CENTRAL_ADMIN):
        raise HTTPException(403, "superadmin_only")
    stmt = select(AuditLog)
    if entity:
        stmt = stmt.where(AuditLog.entity == entity)
    if entity_id:
        stmt = stmt.where(AuditLog.entity_id == entity_id)
    if user_id:
        stmt = stmt.where(AuditLog.user_id == user_id)
    if date_from:
        stmt = stmt.where(AuditLog.created_at >= date_from)
    if date_to:
        stmt = stmt.where(AuditLog.created_at <= date_to)

    # Audit 2026-05-22 #H1: exclude entry yg merefer ke entity di proyek
    # NON_PROJECT utk non-SUPERADMIN. NP = rahasia SUPERADMIN-only.
    # Sebelumnya bocor: CENTRAL_ADMIN bisa lihat entity_id + snapshot
    # tx/invoice/PO milik NP project lewat list audit.
    if user.role != UserRole.SUPERADMIN:
        np_pid_subq = select(Project.id).where(
            Project.kind == ProjectKind.NON_PROJECT.value
        ).scalar_subquery()
        np_tx_ids = select(Transaction.id).where(
            Transaction.project_id.in_(np_pid_subq)
        ).scalar_subquery()
        np_inv_ids = select(Invoice.id).where(
            Invoice.project_id.in_(np_pid_subq)
        ).scalar_subquery()
        np_po_ids = select(PurchaseOrder.id).where(
            PurchaseOrder.project_id.in_(np_pid_subq)
        ).scalar_subquery()
        stmt = stmt.where(
            ~(
                ((AuditLog.entity == "project") & AuditLog.entity_id.in_(np_pid_subq))
                | ((AuditLog.entity == "transaction") & AuditLog.entity_id.in_(np_tx_ids))
                | ((AuditLog.entity == "invoice") & AuditLog.entity_id.in_(np_inv_ids))
                | ((AuditLog.entity == "purchase_order") & AuditLog.entity_id.in_(np_po_ids))
            )
        )

    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar_one()
    stmt = stmt.order_by(AuditLog.id.desc()).offset((page - 1) * size).limit(size)
    rows = (await db.execute(stmt)).scalars().all()
    user_map = {u.id: u for u in (await db.execute(select(User))).scalars().all()}
    items = [
        {
            "id": r.id,
            "created_at": r.created_at.isoformat(),
            "user_id": r.user_id,
            "user_name": user_map.get(r.user_id).name if user_map.get(r.user_id) else None,
            "entity": r.entity,
            "entity_id": r.entity_id,
            "action": r.action.value,
            "before": r.before,
            "after": r.after,
            "note": r.note,
        }
        for r in rows
    ]
    return Page(items=items, total=total, page=page, size=size)
