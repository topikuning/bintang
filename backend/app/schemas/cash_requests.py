"""Pydantic schemas utk Pengajuan Dana Operasional (CashRequest)."""
from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, Field


# ---------- Items ----------
class CashRequestItemIn(BaseModel):
    """Input item saat create/update. Tdk ada id (server-generated)."""
    category_id: int | None = None
    description: str = Field(..., min_length=1, max_length=300)
    quantity: Decimal | None = None
    unit_price: Decimal | None = None
    amount: Decimal = Field(..., gt=0)


class CashRequestItemOut(BaseModel):
    id: int
    category_id: int | None
    category_name: str | None = None
    description: str
    quantity: Decimal | None
    unit_price: Decimal | None
    amount: Decimal

    class Config:
        from_attributes = True


# ---------- Header ----------
class CashRequestBase(BaseModel):
    project_id: int
    recipient_user_id: int | None = None
    request_date: date
    title: str = Field(..., min_length=1, max_length=200)
    notes: str | None = None


class CashRequestCreate(CashRequestBase):
    """Items wajib min 1 baris (kalau cuma 1 entry, isi 1 item)."""
    items: list[CashRequestItemIn] = Field(..., min_length=1)


class CashRequestUpdate(BaseModel):
    """Partial update. Hanya PENDING yg boleh diubah. items=None artinya
    tdk diubah; items=[] artinya hapus semua (validasi error)."""
    project_id: int | None = None
    recipient_user_id: int | None = None
    request_date: date | None = None
    title: str | None = Field(default=None, max_length=200)
    notes: str | None = None
    items: list[CashRequestItemIn] | None = None


class CashRequestOut(BaseModel):
    id: int
    number: str
    project_id: int
    project_code: str | None = None
    project_name: str | None = None
    requester_id: int
    requester_name: str | None = None
    recipient_user_id: int | None
    recipient_name: str | None = None
    request_date: date
    title: str
    notes: str | None
    total_amount: Decimal
    status: str
    approved_by_id: int | None
    approved_by_name: str | None = None
    approved_at: datetime | None
    rejected_by_id: int | None
    rejected_by_name: str | None = None
    rejected_at: datetime | None
    rejection_reason: str | None
    disbursement_tx_id: int | None
    items: list[CashRequestItemOut] = []
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


# ---------- Action payloads ----------
class CashRequestRejectIn(BaseModel):
    reason: str = Field(..., min_length=1, max_length=1000)


class CashRequestCancelIn(BaseModel):
    reason: str | None = None
