"""Excel import service.

For each module, accepts an XLSX file, validates row-by-row, and either
returns a preview (dry-run) or commits to DB.

Multi-row entities (invoices, purchase orders) are grouped by a key column
so each unique value becomes one record with its line items.
"""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from io import BytesIO
from typing import Any, Awaitable, Callable

from openpyxl import Workbook, load_workbook
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.models import (
    Category,
    CategoryType,
    Company,
    Invoice,
    InvoiceItem,
    InvoiceStatus,
    InvoiceType,
    PartyType,
    PaymentMethod,
    POItem,
    POStatus,
    Project,
    ProjectStatus,
    PurchaseOrder,
    Transaction,
    TxnStatus,
    TxnType,
    User,
    VendorClient,
    VendorClientType,
)


# ---------- Generic helpers ----------
def _str(v: Any) -> str | None:
    if v is None:
        return None
    s = str(v).strip()
    return s or None


def _parse_date(v: Any) -> date | None:
    if v is None or v == "":
        return None
    if isinstance(v, datetime):
        return v.date()
    if isinstance(v, date):
        return v
    s = str(v).strip()
    for fmt in ("%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y", "%Y/%m/%d", "%m/%d/%Y"):
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    raise ValueError(f"Tanggal tidak dikenali: {s}")


def _parse_decimal(v: Any) -> Decimal:
    if v is None or v == "":
        return Decimal("0")
    if isinstance(v, (int, float, Decimal)):
        return Decimal(str(v))
    s = str(v).strip().replace(" ", "").replace("Rp", "").replace("rp", "")
    # Indonesian: "1.000.000,50" → "1000000.50"; English: "1,000,000.50"
    if "," in s and "." in s:
        # if comma comes after dot, comma is decimal separator
        if s.rfind(",") > s.rfind("."):
            s = s.replace(".", "").replace(",", ".")
        else:
            s = s.replace(",", "")
    elif "," in s:
        # only comma -> assume Indonesian decimal
        if s.count(",") == 1 and len(s.split(",")[1]) <= 2:
            s = s.replace(",", ".")
        else:
            s = s.replace(",", "")
    try:
        return Decimal(s)
    except InvalidOperation:
        raise ValueError(f"Nilai numerik tidak valid: {v}")


def _parse_enum(value: Any, enum_cls, field_name: str):
    if value is None:
        raise ValueError(f"{field_name} wajib diisi")
    s = str(value).strip().upper()
    aliases = {
        "MASUK": "IN", "IN": "IN", "INCOME": "IN",
        "KELUAR": "OUT", "OUT": "OUT", "EXPENSE": "OUT",
        "VENDOR": "VENDOR", "CLIENT": "CLIENT", "BOTH": "BOTH",
        "AKTIF": "AKTIF", "ACTIVE": "AKTIF",
        "SELESAI": "SELESAI", "DONE": "SELESAI",
        "DITAHAN": "DITAHAN", "ON_HOLD": "DITAHAN", "HOLD": "DITAHAN",
        "DIBATALKAN": "DIBATALKAN", "CANCELLED": "DIBATALKAN",
        "CASH": "CASH", "TUNAI": "CASH",
        "TRANSFER": "TRANSFER", "TF": "TRANSFER",
        "QRIS": "QRIS", "GIRO": "GIRO", "OTHER": "OTHER", "LAINNYA": "OTHER",
        "COMPANY": "COMPANY", "PERUSAHAAN": "COMPANY",
        "PERSONAL": "PERSONAL", "EMPLOYEE": "EMPLOYEE", "KARYAWAN": "EMPLOYEE",
        "INTERNAL": "INTERNAL", "OPERASIONAL": "INTERNAL",
    }
    s = aliases.get(s, s)
    try:
        return enum_cls(s)
    except ValueError:
        valid = [e.value for e in enum_cls]
        raise ValueError(f"{field_name} '{value}' tidak valid (pilihan: {', '.join(valid)})")


def read_xlsx(content: bytes) -> list[dict[str, Any]]:
    wb = load_workbook(BytesIO(content), data_only=True)
    ws = wb.active
    if ws is None:
        return []
    rows = list(ws.iter_rows(values_only=True))
    if not rows:
        return []
    headers = [str(h).strip() if h is not None else f"col_{i}" for i, h in enumerate(rows[0])]
    out: list[dict[str, Any]] = []
    for r in rows[1:]:
        if all(c is None or str(c).strip() == "" for c in r):
            continue
        out.append({headers[i]: r[i] for i in range(len(headers))})
    return out


def build_template(headers: list[str], example: list[Any] | None = None) -> bytes:
    wb = Workbook()
    ws = wb.active
    if ws is not None:
        ws.append(headers)
        for cell in ws[1]:
            cell.font = cell.font.copy(bold=True)
        if example:
            ws.append(example)
        for i, h in enumerate(headers, 1):
            from openpyxl.utils import get_column_letter
            ws.column_dimensions[get_column_letter(i)].width = max(14, min(40, len(str(h)) + 4))
    buf = BytesIO()
    wb.save(buf)
    return buf.getvalue()


# ---------- Entity-specific importers ----------
async def _lookup(db: AsyncSession, model, **filters):
    stmt = select(model).filter_by(**filters)
    return (await db.execute(stmt)).scalar_one_or_none()


async def import_companies(rows, db, user, commit):
    errors, valid = [], []
    for i, r in enumerate(rows, start=2):
        try:
            name = _str(r.get("name"))
            if not name:
                raise ValueError("name wajib diisi")
            if commit:
                exists = await _lookup(db, Company, name=name)
                if exists and exists.deleted_at is None:
                    raise ValueError(f"Perusahaan '{name}' sudah ada")
                db.add(Company(
                    name=name,
                    address=_str(r.get("address")),
                    npwp=_str(r.get("npwp")),
                    phone=_str(r.get("phone")),
                    email=_str(r.get("email")),
                    director_name=_str(r.get("director_name")),
                    bank_account=_str(r.get("bank_account")),
                ))
            valid.append({"name": name})
        except Exception as e:
            errors.append({"row": i, "message": str(e), "raw": r})
    return valid, errors


async def import_categories(rows, db, user, commit):
    errors, valid = [], []
    for i, r in enumerate(rows, start=2):
        try:
            name = _str(r.get("name"))
            if not name:
                raise ValueError("name wajib diisi")
            ctype = _parse_enum(r.get("type"), CategoryType, "type")
            if commit:
                db.add(Category(name=name, type=ctype, description=_str(r.get("description"))))
            valid.append({"name": name, "type": ctype.value})
        except Exception as e:
            errors.append({"row": i, "message": str(e), "raw": r})
    return valid, errors


async def import_vendors_clients(rows, db, user, commit):
    errors, valid = [], []
    for i, r in enumerate(rows, start=2):
        try:
            name = _str(r.get("name"))
            if not name:
                raise ValueError("name wajib diisi")
            vtype = VendorClientType.VENDOR
            if r.get("type"):
                vtype = _parse_enum(r.get("type"), VendorClientType, "type")
            if commit:
                db.add(VendorClient(
                    name=name, type=vtype,
                    contact=_str(r.get("contact")),
                    phone=_str(r.get("phone")),
                    email=_str(r.get("email")),
                    npwp=_str(r.get("npwp")),
                    address=_str(r.get("address")),
                    bank_account=_str(r.get("bank_account")),
                ))
            valid.append({"name": name, "type": vtype.value})
        except Exception as e:
            errors.append({"row": i, "message": str(e), "raw": r})
    return valid, errors


async def import_projects(rows, db, user, commit):
    errors, valid = [], []
    for i, r in enumerate(rows, start=2):
        try:
            code = _str(r.get("code"))
            name = _str(r.get("name"))
            company_name = _str(r.get("company_name"))
            if not (code and name and company_name):
                raise ValueError("code, name, company_name wajib")
            company = await _lookup(db, Company, name=company_name)
            if not company or company.deleted_at is not None:
                raise ValueError(f"Perusahaan '{company_name}' tidak ditemukan")
            pic_id = None
            if pic_email := _str(r.get("pic_email")):
                pic = await _lookup(db, User, email=pic_email)
                if not pic:
                    raise ValueError(f"User PIC '{pic_email}' tidak ditemukan")
                pic_id = pic.id
            status = ProjectStatus.AKTIF
            if r.get("status"):
                status = _parse_enum(r.get("status"), ProjectStatus, "status")
            if commit:
                if await _lookup(db, Project, code=code):
                    raise ValueError(f"Kode proyek '{code}' sudah ada")
                p = Project(
                    code=code, name=name,
                    location=_str(r.get("location")),
                    company_id=company.id,
                    pic_user_id=pic_id,
                    start_date=_parse_date(r.get("start_date")),
                    end_date=_parse_date(r.get("end_date")),
                    status=status,
                    notes=_str(r.get("notes")),
                    budget_amount=_parse_decimal(r.get("budget_amount")),
                    currency=_str(r.get("currency")) or "IDR",
                    overbudget_tolerance_pct=_parse_decimal(r.get("overbudget_tolerance_pct") or 0),
                )
                db.add(p)
            valid.append({"code": code, "name": name})
        except Exception as e:
            errors.append({"row": i, "message": str(e), "raw": r})
    return valid, errors


async def import_transactions(rows, db, user, commit):
    errors, valid = [], []
    for i, r in enumerate(rows, start=2):
        try:
            project_code = _str(r.get("project_code"))
            if not project_code:
                raise ValueError("project_code wajib")
            project = await _lookup(db, Project, code=project_code)
            if not project or project.deleted_at is not None:
                raise ValueError(f"Proyek '{project_code}' tidak ditemukan")
            tx_date = _parse_date(r.get("tx_date"))
            if not tx_date:
                raise ValueError("tx_date wajib")
            ttype = _parse_enum(r.get("type"), TxnType, "type")
            amount = _parse_decimal(r.get("amount"))
            if amount <= 0:
                raise ValueError("amount harus > 0")
            cat_id = None
            if cn := _str(r.get("category_name")):
                cat = await _lookup(db, Category, name=cn)
                if not cat:
                    raise ValueError(f"Kategori '{cn}' tidak ditemukan")
                cat_id = cat.id
            vc_id = None
            if vn := _str(r.get("vendor_client_name")):
                vc = await _lookup(db, VendorClient, name=vn)
                if vc:
                    vc_id = vc.id
            method = PaymentMethod.TRANSFER
            if r.get("payment_method"):
                method = _parse_enum(r.get("payment_method"), PaymentMethod, "payment_method")
            party_type = None
            if r.get("party_type"):
                party_type = _parse_enum(r.get("party_type"), PartyType, "party_type")
            if commit:
                db.add(Transaction(
                    project_id=project.id,
                    tx_date=tx_date,
                    type=ttype,
                    category_id=cat_id,
                    amount=amount,
                    party_type=party_type,
                    party_name=_str(r.get("party_name")),
                    vendor_client_id=vc_id,
                    payment_method=method,
                    reference_no=_str(r.get("reference_no")),
                    description=_str(r.get("description")),
                    status=TxnStatus.DRAFT,
                    created_by_id=user.id,
                ))
            valid.append({
                "project": project_code, "tx_date": tx_date.isoformat(),
                "type": ttype.value, "amount": str(amount),
            })
        except Exception as e:
            errors.append({"row": i, "message": str(e), "raw": r})
    return valid, errors


async def import_invoices(rows, db, user, commit):
    """Multi-row per invoice, grouped by `number`. Header fields taken from first row."""
    errors, valid = [], []
    groups: dict[str, list[tuple[int, dict]]] = {}
    for i, r in enumerate(rows, start=2):
        num = _str(r.get("number"))
        if not num:
            errors.append({"row": i, "message": "number wajib", "raw": r})
            continue
        groups.setdefault(num, []).append((i, r))

    for num, group in groups.items():
        first_row_num, first = group[0]
        try:
            project_code = _str(first.get("project_code"))
            project = await _lookup(db, Project, code=project_code) if project_code else None
            if not project:
                raise ValueError(f"Proyek '{project_code}' tidak ditemukan")
            itype = _parse_enum(first.get("type"), InvoiceType, "type")
            inv_date = _parse_date(first.get("invoice_date"))
            if not inv_date:
                raise ValueError("invoice_date wajib")
            due = _parse_date(first.get("due_date"))
            tax = _parse_decimal(first.get("tax") or 0)
            vc_id = None
            if vn := _str(first.get("vendor_client_name")):
                vc = await _lookup(db, VendorClient, name=vn)
                if vc:
                    vc_id = vc.id

            items: list[InvoiceItem] = []
            for row_no, r in group:
                desc = _str(r.get("item_description"))
                if not desc:
                    continue
                qty = _parse_decimal(r.get("item_quantity") or 1)
                price = _parse_decimal(r.get("item_unit_price") or 0)
                items.append(InvoiceItem(
                    description=desc, quantity=qty,
                    unit=_str(r.get("item_unit")),
                    unit_price=price, subtotal=price * qty,
                ))
            subtotal = sum((it.subtotal for it in items), Decimal("0"))
            total = subtotal + tax
            if commit:
                if await _lookup(db, Invoice, number=num):
                    raise ValueError(f"Invoice '{num}' sudah ada")
                inv = Invoice(
                    number=num, project_id=project.id, type=itype,
                    invoice_date=inv_date, due_date=due,
                    vendor_client_id=vc_id,
                    party_name=_str(first.get("party_name")),
                    subtotal=subtotal, tax=tax, total=total,
                    status=InvoiceStatus.DRAFT,
                    notes=_str(first.get("notes")),
                    created_by_id=user.id,
                )
                for it in items:
                    inv.items.append(it)
                db.add(inv)
            valid.append({"number": num, "items": len(items), "total": str(total)})
        except Exception as e:
            errors.append({"row": first_row_num, "message": str(e),
                           "raw": {"number": num}})
    return valid, errors


async def import_purchase_orders(rows, db, user, commit):
    """Grouped by `_po_ref` column (any unique key per PO)."""
    errors, valid = [], []
    groups: dict[str, list[tuple[int, dict]]] = {}
    for i, r in enumerate(rows, start=2):
        ref = _str(r.get("_po_ref"))
        if not ref:
            errors.append({"row": i, "message": "_po_ref wajib (untuk grouping item PO yang sama)", "raw": r})
            continue
        groups.setdefault(ref, []).append((i, r))

    from sqlalchemy import func as sa_func
    for ref, group in groups.items():
        first_row_num, first = group[0]
        try:
            project_code = _str(first.get("project_code"))
            project = await _lookup(db, Project, code=project_code)
            if not project:
                raise ValueError(f"Proyek '{project_code}' tidak ditemukan")
            company_name = _str(first.get("company_name"))
            company = await _lookup(db, Company, name=company_name) if company_name else None
            if not company:
                raise ValueError(f"Perusahaan '{company_name}' tidak ditemukan")
            po_date = _parse_date(first.get("po_date"))
            if not po_date:
                raise ValueError("po_date wajib")
            needed = _parse_date(first.get("needed_date"))
            tax = _parse_decimal(first.get("tax") or 0)
            discount = _parse_decimal(first.get("discount") or 0)
            vc_id = None
            if vn := _str(first.get("vendor_client_name")):
                vc = await _lookup(db, VendorClient, name=vn)
                if vc:
                    vc_id = vc.id

            items: list[POItem] = []
            for row_no, r in group:
                desc = _str(r.get("item_description"))
                if not desc:
                    continue
                qty = _parse_decimal(r.get("item_quantity") or 1)
                price = _parse_decimal(r.get("item_unit_price") or 0)
                items.append(POItem(
                    description=desc, quantity=qty,
                    unit=_str(r.get("item_unit")),
                    unit_price=price, subtotal=price * qty,
                ))
            subtotal = sum((it.subtotal for it in items), Decimal("0"))
            total = subtotal + tax - discount
            if commit:
                # auto numbering
                prefix = f"PO/{po_date.year}/{po_date.month:02d}/{project.code.upper()}/"
                count_q = (await db.execute(
                    select(sa_func.count()).select_from(PurchaseOrder).where(
                        PurchaseOrder.company_id == company.id,
                        PurchaseOrder.number.like(f"{prefix}%"),
                    )
                )).scalar_one()
                number = f"{prefix}{count_q + 1:04d}"
                po = PurchaseOrder(
                    number=number, project_id=project.id, company_id=company.id,
                    vendor_client_id=vc_id, vendor_name=_str(first.get("vendor_name")),
                    po_date=po_date, needed_date=needed,
                    subtotal=subtotal, tax=tax, discount=discount, total=total,
                    payment_terms=_str(first.get("payment_terms")),
                    notes=_str(first.get("notes")),
                    status=POStatus.DRAFT,
                    created_by_id=user.id,
                )
                for it in items:
                    po.items.append(it)
                db.add(po)
            valid.append({"_po_ref": ref, "items": len(items), "total": str(total)})
        except Exception as e:
            errors.append({"row": first_row_num, "message": str(e), "raw": {"_po_ref": ref}})
    return valid, errors


# ---------- Registry ----------
EntityHandler = Callable[[list[dict], AsyncSession, Any, bool], Awaitable[tuple[list, list]]]


SCHEMAS: dict[str, dict[str, Any]] = {
    "companies": {
        "label": "Perusahaan",
        "headers": ["name", "address", "npwp", "phone", "email", "director_name", "bank_account"],
        "example": ["PT Contoh Sejahtera", "Jl. Demo No. 1", "01.234.567.8-091.000",
                    "021-1234567", "info@contoh.co.id", "Direktur Utama",
                    "BCA 123-456-789"],
        "handler": import_companies,
    },
    "categories": {
        "label": "Kategori",
        "headers": ["name", "type", "description"],
        "example": ["Material Bangunan", "OUT", "Semen, besi, dll"],
        "handler": import_categories,
    },
    "vendors-clients": {
        "label": "Vendor / Client",
        "headers": ["name", "type", "contact", "phone", "email", "npwp", "address", "bank_account"],
        "example": ["Toko Bangunan Sentosa", "VENDOR", "Pak Joko", "021-555-1111",
                    "joko@sentosa.co.id", "", "", "BCA 222-333-444"],
        "handler": import_vendors_clients,
    },
    "projects": {
        "label": "Proyek",
        "headers": ["code", "name", "location", "company_name", "pic_email",
                    "start_date", "end_date", "status", "budget_amount",
                    "currency", "overbudget_tolerance_pct", "notes"],
        "example": ["PRJ-DEMO", "Proyek Demo", "Jakarta",
                    "PT Contoh Sejahtera", "budi@bintang.me",
                    "2026-04-01", "2026-12-31", "AKTIF", 250000000,
                    "IDR", 5, "Catatan demo"],
        "handler": import_projects,
    },
    "transactions": {
        "label": "Transaksi",
        "headers": ["project_code", "tx_date", "type", "category_name", "amount",
                    "party_name", "party_type", "vendor_client_name",
                    "payment_method", "reference_no", "description"],
        "example": ["PRJ-001", "2026-04-15", "OUT", "Material Bangunan", 5500000,
                    "Toko Bangunan Sentosa", "COMPANY", "Toko Bangunan Sentosa",
                    "TRANSFER", "TRF-2026-001", "Pembelian semen 50 sak"],
        "handler": import_transactions,
    },
    "invoices": {
        "label": "Invoice",
        "headers": ["number", "project_code", "type", "invoice_date", "due_date",
                    "vendor_client_name", "party_name", "tax", "notes",
                    "item_description", "item_quantity", "item_unit", "item_unit_price"],
        "example": ["INV/2026/04/PRJ-001/0099", "PRJ-001", "OUT", "2026-04-20",
                    "2026-05-20", "PT Klien Sukses Makmur", "PT Klien Sukses Makmur",
                    11000000, "Termin demo", "Pekerjaan struktur", 1, "lot", 100000000],
        "handler": import_invoices,
        "note": "Untuk invoice dengan banyak item: ulang baris dengan number yang sama, isi kolom item_* berbeda.",
    },
    "purchase-orders": {
        "label": "Purchase Order",
        "headers": ["_po_ref", "project_code", "company_name", "vendor_client_name",
                    "vendor_name", "po_date", "needed_date", "tax", "discount",
                    "payment_terms", "notes",
                    "item_description", "item_quantity", "item_unit", "item_unit_price"],
        "example": ["PO-1", "PRJ-001", "PT Bintang Karya Abadi",
                    "CV Mitra Beton Pratama", "CV Mitra Beton Pratama",
                    "2026-04-15", "2026-04-25", 0, 0, "NET 30", "",
                    "Beton K-300 ready mix", 50, "m3", 400000],
        "handler": import_purchase_orders,
        "note": "Pakai _po_ref unik per PO. Tambah baris dengan _po_ref sama untuk item lain.",
    },
}
