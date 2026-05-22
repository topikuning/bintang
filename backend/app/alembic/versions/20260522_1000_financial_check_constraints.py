"""financial_check_constraints

Tambah CHECK constraints di level DB utk pencegahan nilai negatif/zero
yg invalid akunting. Sebelumnya validasi hanya di Pydantic endpoint
-> direct SQL/ORM bypass bisa korup financial data.

Per audit diagnosis 2026-05-22 #C4.

Konstrain:
- transactions.amount > 0
- transaction_items.amount > 0
- cash_advance_settlements.returned_to_kas >= 0
- cash_advance_settlement_items.amount > 0
- cash_requests.total_amount >= 0
- cash_request_items.amount > 0
- invoices.subtotal/tax/total >= 0
- invoice_items.quantity > 0, unit_price >= 0
- purchase_orders.subtotal/tax/discount/total >= 0
- po_items.quantity > 0, unit_price >= 0

Pakai batch_alter_table utk SQLite compat (CREATE TABLE alternative).

Revision ID: b7e2f4a8c9d1
Revises: a5c7e9d2b3f4
"""
from typing import Sequence, Union

from alembic import op


revision: str = 'b7e2f4a8c9d1'
down_revision: Union[str, Sequence[str], None] = 'a5c7e9d2b3f4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# (table, constraint_name, condition)
CONSTRAINTS = [
    ("transactions",
     "ck_transactions_amount_positive", "amount > 0"),
    ("transaction_items",
     "ck_transaction_items_amount_positive", "amount > 0"),
    ("cash_advance_settlements",
     "ck_cash_advance_settlements_returned_nonneg", "returned_to_kas >= 0"),
    ("cash_advance_settlement_items",
     "ck_cash_advance_settlement_items_amount_positive", "amount > 0"),
    ("cash_requests",
     "ck_cash_requests_total_nonneg", "total_amount >= 0"),
    ("cash_request_items",
     "ck_cash_request_items_amount_positive", "amount > 0"),
    ("invoices",
     "ck_invoices_subtotal_nonneg", "subtotal >= 0"),
    ("invoices",
     "ck_invoices_tax_nonneg", "tax >= 0"),
    ("invoices",
     "ck_invoices_total_nonneg", "total >= 0"),
    ("invoice_items",
     "ck_invoice_items_quantity_positive", "quantity > 0"),
    ("invoice_items",
     "ck_invoice_items_unit_price_nonneg", "unit_price >= 0"),
    ("purchase_orders",
     "ck_po_subtotal_nonneg", "subtotal >= 0"),
    ("purchase_orders",
     "ck_po_tax_nonneg", "tax >= 0"),
    ("purchase_orders",
     "ck_po_discount_nonneg", "discount >= 0"),
    ("purchase_orders",
     "ck_po_total_nonneg", "total >= 0"),
    ("po_items",
     "ck_po_items_quantity_positive", "quantity > 0"),
    ("po_items",
     "ck_po_items_unit_price_nonneg", "unit_price >= 0"),
]


def upgrade() -> None:
    for table, name, cond in CONSTRAINTS:
        with op.batch_alter_table(table) as batch:
            batch.create_check_constraint(name, cond)


def downgrade() -> None:
    for table, name, _ in reversed(CONSTRAINTS):
        with op.batch_alter_table(table) as batch:
            batch.drop_constraint(name, type_="check")
