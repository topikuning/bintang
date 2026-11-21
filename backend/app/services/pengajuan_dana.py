"""Aturan setujui/tolak Pengajuan Dana (CashRequest), dipakai bersama oleh
endpoint aplikasi dan alur WhatsApp (/kas). Pemanggil yang commit."""

from __future__ import annotations

from datetime import UTC, datetime

from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.models import (
    AuditAction,
    CashRequest,
    CashRequestStatus,
    PaymentMethod,
    Project,
    Transaction,
    TxnKind,
    TxnStatus,
    TxnType,
    User,
)
from app.services.audit import log, snapshot


async def setujui(db: AsyncSession, cr: CashRequest, admin: User) -> Transaction:
    """PENDING -> APPROVED; otomatis membuat tx CASH_ADVANCE DRAFT (pencairan)."""
    if cr.status != CashRequestStatus.PENDING.value:
        raise HTTPException(400, "only_pending_can_be_approved")
    if not cr.items:
        raise HTTPException(400, "no_items")
    proj = await db.get(Project, cr.project_id)
    if not proj or proj.deleted_at is not None:
        raise HTTPException(400, "project_unavailable")

    before = snapshot(cr)
    # Recipient = recipient_user_id kalau ada, else requester. Penerima di
    # luar aplikasi (penerima_nama) dicatat sebagai nama penerima tx.
    recipient_id = cr.recipient_user_id or cr.requester_id
    recipient = await db.get(User, recipient_id)
    tx = Transaction(
        project_id=cr.project_id,
        tx_date=cr.request_date,
        type=TxnType.OUT,
        kind=TxnKind.CASH_ADVANCE.value,
        amount=cr.total_amount,
        description=f"[Pengajuan {cr.number}] {cr.title}",
        usage_note=cr.notes,
        recipient_user_id=recipient_id,
        recipient_name=cr.penerima_nama or (recipient.name if recipient else None),
        payment_method=PaymentMethod.TRANSFER,
        status=TxnStatus.DRAFT,
        created_by_id=admin.id,
    )
    db.add(tx)
    await db.flush()

    cr.status = CashRequestStatus.APPROVED.value
    cr.approved_by_id = admin.id
    cr.approved_at = datetime.now(UTC)
    cr.disbursement_tx_id = tx.id
    await db.flush()
    await log(
        db,
        user_id=admin.id,
        entity="cash_request",
        entity_id=cr.id,
        action=AuditAction.UPDATE,
        before=before,
        after=snapshot(cr),
    )
    return tx


async def tolak(db: AsyncSession, cr: CashRequest, admin: User, alasan: str) -> None:
    if cr.status != CashRequestStatus.PENDING.value:
        raise HTTPException(400, "only_pending_can_be_rejected")
    before = snapshot(cr)
    cr.status = CashRequestStatus.REJECTED.value
    cr.rejected_by_id = admin.id
    cr.rejected_at = datetime.now(UTC)
    cr.rejection_reason = alasan.strip()
    await db.flush()
    await log(
        db,
        user_id=admin.id,
        entity="cash_request",
        entity_id=cr.id,
        action=AuditAction.UPDATE,
        before=before,
        after=snapshot(cr),
    )
