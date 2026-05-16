"""Regression: project_id IMMUTABLE via UPDATE -- tx & invoice.

Bug class baru-baru ini: schema TransactionUpdate & InvoiceUpdate tdk
punya field `project_id` -> Pydantic v2 silent-ignore unknown field ->
setattr loop di endpoint tdk re-assign project_id -> save OK -> 200 ->
toast hijau di frontend -> user kira "berhasil" padahal data tdk berubah.

Fix: tambah field `project_id: int | None = None` di schema (no longer
silent-ignored), lalu endpoint reject explisit kalau payload kirim
project_id BEDA dari current dgn 400 "project_change_forbidden".
Sama untuk current value -> no-op (no error).
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal

from app.schemas.finance import InvoiceUpdate, TransactionUpdate


def test_transaction_update_schema_has_project_id():
    """Field project_id WAJIB ada di schema -- supaya Pydantic tdk
    silent-ignore. Validate by direct schema instantiate."""
    u = TransactionUpdate(project_id=42)
    assert u.project_id == 42
    # Default tdk-set -> None (back-compat: payload tanpa project_id OK)
    u2 = TransactionUpdate()
    assert u2.project_id is None
    # exclude_unset penting: payload tanpa project_id tdk muncul di
    # model_dump -> endpoint dpt deteksi via `is not None`
    dumped = TransactionUpdate(amount=Decimal("100")).model_dump(exclude_unset=True)
    assert "project_id" not in dumped


def test_invoice_update_schema_has_project_id():
    u = InvoiceUpdate(project_id=42)
    assert u.project_id == 42
    u2 = InvoiceUpdate()
    assert u2.project_id is None
    dumped = InvoiceUpdate(number="INV-1").model_dump(exclude_unset=True)
    assert "project_id" not in dumped


def test_transaction_update_silent_field_was_the_bug():
    """Smoke: kalau seseorang nanti hapus field project_id dari schema,
    payload include project_id akan kembali silent-drop -> regress.
    Ini guard: pastikan field tetap di-recognize."""
    # Pakai keyword unknown vs project_id -> Pydantic v2 default
    # (extra=ignore) silently drop. Confirm project_id NOT dropped.
    u = TransactionUpdate.model_validate({"project_id": 99, "garbage_field": "x"})
    assert u.project_id == 99
    # garbage_field harus DI-DROP (sesuai default Pydantic v2 ignore).
    dumped = u.model_dump(exclude_unset=True)
    assert "garbage_field" not in dumped
    assert dumped.get("project_id") == 99
