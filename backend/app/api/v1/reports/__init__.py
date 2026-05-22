"""Reports package: aggregate router dari sub-modul.

Audit 2026-05-22 #M2: dipecah dari reports.py (1290 baris) jadi:
- finance.py: cashflow, transactions, direct_expenses
- documents.py: invoices, debts, purchase_orders
- governance.py: budget, cash_advances, audit_logs

Import path tetap `app.api.v1.reports` -- caller `app.api.v1.__init__`
tdk perlu berubah.
"""
from fastapi import APIRouter

from . import documents, finance, governance

router = APIRouter()
router.include_router(finance.router)
router.include_router(documents.router)
router.include_router(governance.router)
