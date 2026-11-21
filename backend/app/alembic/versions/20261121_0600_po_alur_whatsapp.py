"""Alur PO lewat WhatsApp: kolom pemasok/tempo/tahap di PO, tautan tagihan ke PO.

Revision ID: q2d8f4b7c1e5
Revises: p4e8b2a6d1f9
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "q2d8f4b7c1e5"
down_revision: str | Sequence[str] | None = "p4e8b2a6d1f9"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("purchase_orders", sa.Column("supplier_wa", sa.String(length=64), nullable=True))
    op.add_column("purchase_orders", sa.Column("tempo_days", sa.Integer(), nullable=True))
    op.add_column("purchase_orders", sa.Column("wa_tahap", sa.String(length=30), nullable=True))
    op.add_column("purchase_orders", sa.Column("diterima_at", sa.Date(), nullable=True))
    op.create_index("ix_purchase_orders_supplier_wa", "purchase_orders", ["supplier_wa"])
    op.create_index("ix_purchase_orders_wa_tahap", "purchase_orders", ["wa_tahap"])

    op.add_column("invoices", sa.Column("purchase_order_id", sa.Integer(), nullable=True))
    op.create_foreign_key(
        "fk_invoices_purchase_order_id_purchase_orders",
        "invoices",
        "purchase_orders",
        ["purchase_order_id"],
        ["id"],
    )
    op.create_index("ix_invoices_purchase_order_id", "invoices", ["purchase_order_id"])


def downgrade() -> None:
    op.drop_index("ix_invoices_purchase_order_id", table_name="invoices")
    op.drop_constraint(
        "fk_invoices_purchase_order_id_purchase_orders", "invoices", type_="foreignkey"
    )
    op.drop_column("invoices", "purchase_order_id")

    op.drop_index("ix_purchase_orders_wa_tahap", table_name="purchase_orders")
    op.drop_index("ix_purchase_orders_supplier_wa", table_name="purchase_orders")
    op.drop_column("purchase_orders", "diterima_at")
    op.drop_column("purchase_orders", "wa_tahap")
    op.drop_column("purchase_orders", "tempo_days")
    op.drop_column("purchase_orders", "supplier_wa")
