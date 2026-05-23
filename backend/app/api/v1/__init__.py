from fastapi import APIRouter

from app.api.v1 import (
    admin_orphans,
    admin_role_menus,
    admin_settings,
    allocations,
    attachments,
    audit_logs,
    auth,
    budget,
    cash_requests,
    categories,
    companies,
    ai,
    dashboard,
    imports,
    invoices,
    messaging,
    non_project,
    notifications,
    ocr,
    projects,
    purchase_orders,
    reports,
    telegram,
    transactions,
    users,
    vendors_clients,
    whatsapp,
)

api_router = APIRouter()
api_router.include_router(auth.router, prefix="/auth", tags=["auth"])
api_router.include_router(users.router, prefix="/users", tags=["users"])
api_router.include_router(companies.router, prefix="/companies", tags=["companies"])
api_router.include_router(projects.router, prefix="/projects", tags=["projects"])
api_router.include_router(categories.router, prefix="/categories", tags=["categories"])
api_router.include_router(
    vendors_clients.router, prefix="/vendors-clients", tags=["vendors-clients"]
)
api_router.include_router(transactions.router, prefix="/transactions", tags=["transactions"])
api_router.include_router(invoices.router, prefix="/invoices", tags=["invoices"])
api_router.include_router(
    purchase_orders.router, prefix="/purchase-orders", tags=["purchase-orders"]
)
api_router.include_router(attachments.router, prefix="/attachments", tags=["attachments"])
api_router.include_router(dashboard.router, prefix="/dashboard", tags=["dashboard"])
api_router.include_router(budget.router, prefix="/budget", tags=["budget"])
api_router.include_router(notifications.router, prefix="/notifications", tags=["notifications"])
api_router.include_router(reports.router, prefix="/reports", tags=["reports"])
api_router.include_router(audit_logs.router, prefix="/audit-logs", tags=["audit-logs"])
api_router.include_router(admin_settings.router, prefix="/admin/settings", tags=["admin-settings"])
api_router.include_router(admin_role_menus.router, prefix="/admin/role-menus", tags=["admin-role-menus"])
api_router.include_router(admin_orphans.router, prefix="/admin/orphan-files", tags=["admin-orphans"])
api_router.include_router(imports.router, prefix="/imports", tags=["imports"])
api_router.include_router(ocr.router, prefix="/ocr", tags=["ocr"])
api_router.include_router(ai.router, prefix="/ai", tags=["ai"])
api_router.include_router(telegram.router, prefix="/telegram", tags=["telegram"])
api_router.include_router(whatsapp.router, prefix="/whatsapp", tags=["whatsapp"])
api_router.include_router(messaging.router, prefix="/messaging", tags=["messaging"])
api_router.include_router(non_project.router, prefix="/non-project", tags=["non-project"])
api_router.include_router(cash_requests.router, prefix="/cash-requests", tags=["cash-requests"])
# allocations dipasang di prefix root karena rutenya bercampur:
#   /invoices/{id}/allocations, /transactions/{id}/allocations, /allocations/{id}
api_router.include_router(allocations.router, tags=["allocations"])
