"""In-app notification feed.

Goal: user dapat ringkasan "apa yg perlu attention sekarang" tanpa
buka detail page satu-satu. Polled dari frontend (bell icon di topbar).

Sengaja TIPIS -- bukan log notification per-event. Hanya snapshot
state saat ini:
- Tx pending verifikasi (utk admin = central+project_admin)
- Tx draft milik sendiri (utk submitter)
- Invoice overdue
- PO menunggu approval
- (placeholder future: settlement pending, dst)

Pagination + read/unread state tdk di-track (stateless feed). Kalau
user butuh history, lihat audit-log.
"""
from __future__ import annotations

from datetime import date as date_type
from typing import Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import (
    get_current_user,
    has_global_access,
    user_project_ids,
)
from app.db.session import get_db
from app.models.models import (
    Invoice,
    InvoiceStatus,
    PurchaseOrder,
    POStatus,
    Transaction,
    TxnStatus,
    User,
    UserRole,
)

router = APIRouter()


NotificationKind = Literal[
    "tx_pending_verify",
    "tx_my_draft",
    "invoice_overdue",
    "po_pending_approval",
]


class NotificationItem(BaseModel):
    kind: NotificationKind
    label: str
    count: int
    # Link supaya frontend bisa langsung navigate ke list yg di-filter.
    to: str
    # Severity utk tone visual (warning/danger/info).
    tone: str = "info"


class NotificationSummary(BaseModel):
    total: int
    items: list[NotificationItem]


@router.get("/summary", response_model=NotificationSummary)
async def notifications_summary(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> NotificationSummary:
    """Ringkasan notifikasi user. Polled dari frontend tiap 30 detik."""
    items: list[NotificationItem] = []
    pids = await user_project_ids(db, user)
    is_admin = user.role in (UserRole.SUPERADMIN, UserRole.CENTRAL_ADMIN)
    has_global = has_global_access(user)

    def _scope_filter(stmt, project_col):
        """Scope filter by user's project_ids kalau non-global."""
        if pids is None:
            return stmt
        if not pids:
            return stmt.where(project_col.in_([]))  # forces empty
        return stmt.where(project_col.in_(pids))

    # 1. Tx pending verifikasi (admin only)
    if is_admin:
        q = select(func.count(Transaction.id)).where(
            Transaction.status == TxnStatus.SUBMITTED,
            Transaction.deleted_at.is_(None),
        )
        q = _scope_filter(q, Transaction.project_id)
        n = int((await db.execute(q)).scalar_one() or 0)
        if n > 0:
            items.append(NotificationItem(
                kind="tx_pending_verify",
                label=f"{n} transaksi menunggu verifikasi",
                count=n,
                to="/transactions?status=SUBMITTED",
                tone="warning",
            ))

    # 2. Tx draft milik sendiri (utk reminder submit)
    q = select(func.count(Transaction.id)).where(
        Transaction.created_by_id == user.id,
        Transaction.status == TxnStatus.DRAFT,
        Transaction.deleted_at.is_(None),
    )
    n = int((await db.execute(q)).scalar_one() or 0)
    if n > 0:
        items.append(NotificationItem(
            kind="tx_my_draft",
            label=f"{n} draft transaksi belum kamu submit",
            count=n,
            to="/transactions?status=DRAFT",
            tone="info",
        ))

    # 3. Invoice overdue (untuk semua user yg punya akses)
    today = date_type.today()
    q = select(func.count(Invoice.id)).where(
        Invoice.deleted_at.is_(None),
        Invoice.status.in_([InvoiceStatus.ISSUED, InvoiceStatus.PARTIALLY_PAID, InvoiceStatus.OVERDUE]),
        Invoice.due_date.is_not(None),
        Invoice.due_date < today,
    )
    q = _scope_filter(q, Invoice.project_id)
    n = int((await db.execute(q)).scalar_one() or 0)
    if n > 0:
        items.append(NotificationItem(
            kind="invoice_overdue",
            label=f"{n} invoice lewat jatuh tempo",
            count=n,
            to="/invoices?status=OVERDUE",
            tone="danger",
        ))

    # 4. PO menunggu approval (ISSUED -- belum APPROVED) -- admin only
    if is_admin or has_global:
        q = select(func.count(PurchaseOrder.id)).where(
            PurchaseOrder.deleted_at.is_(None),
            PurchaseOrder.status == POStatus.ISSUED,
        )
        q = _scope_filter(q, PurchaseOrder.project_id)
        n = int((await db.execute(q)).scalar_one() or 0)
        if n > 0:
            items.append(NotificationItem(
                kind="po_pending_approval",
                label=f"{n} PO menunggu approval",
                count=n,
                to="/purchase-orders?status=ISSUED",
                tone="warning",
            ))

    total = sum(it.count for it in items)
    return NotificationSummary(total=total, items=items)
