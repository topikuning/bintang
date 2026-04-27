"""Seed minimum demo data: 1 superadmin, 1 project admin, 1 company, 1 project, categories, vendors."""

from __future__ import annotations

import asyncio
from datetime import date, timedelta
from decimal import Decimal

from sqlalchemy import select

from app.core.security import hash_password
from app.db.base import Base
from app.db.session import SessionLocal, engine
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
    Project,
    ProjectStatus,
    ProjectUser,
    Transaction,
    TxnStatus,
    TxnType,
    User,
    UserRole,
    VendorClient,
    VendorClientType,
)


async def init() -> None:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with SessionLocal() as db:
        existing = (await db.execute(select(User).where(User.email == "admin@bintang.me"))).scalar_one_or_none()
        if existing:
            print("Seed already applied. Skipping.")
            return

        admin = User(
            email="admin@bintang.me",
            password_hash=hash_password("admin123"),
            name="Super Admin",
            role=UserRole.SUPERADMIN,
            is_active=True,
        )
        pm1 = User(
            email="pm1@bintang.me",
            password_hash=hash_password("pm123"),
            name="Pak Budi (PM)",
            role=UserRole.PROJECT_ADMIN,
            is_active=True,
        )
        db.add_all([admin, pm1])
        await db.flush()

        c = Company(
            name="PT Bintang Karya Abadi",
            address="Jl. Merdeka No. 1, Jakarta",
            npwp="01.234.567.8-091.000",
            phone="021-1234567",
            email="info@bka.co.id",
            director_name="Direktur Utama",
            bank_account="BCA 123-456-789 a.n. PT Bintang Karya Abadi",
        )
        db.add(c)
        await db.flush()

        cats = [
            Category(name="Pemasukan Termin", type=CategoryType.IN),
            Category(name="DP Client", type=CategoryType.IN),
            Category(name="Material", type=CategoryType.OUT),
            Category(name="Upah Tukang", type=CategoryType.OUT),
            Category(name="Operasional", type=CategoryType.OUT),
            Category(name="Sewa Alat", type=CategoryType.OUT),
        ]
        db.add_all(cats)

        vendors = [
            VendorClient(name="Toko Bangunan Sentosa", type=VendorClientType.VENDOR, phone="021-9999"),
            VendorClient(name="CV Mitra Beton", type=VendorClientType.VENDOR),
            VendorClient(name="PT Klien Sukses", type=VendorClientType.CLIENT),
        ]
        db.add_all(vendors)
        await db.flush()

        proj = Project(
            code="PRJ-001",
            name="Renovasi Gedung Pusat",
            location="Jakarta Selatan",
            company_id=c.id,
            pic_user_id=pm1.id,
            start_date=date.today() - timedelta(days=30),
            end_date=date.today() + timedelta(days=90),
            status=ProjectStatus.AKTIF,
            notes="Demo project",
            budget_amount=Decimal("500000000"),
            currency="IDR",
            overbudget_tolerance_pct=Decimal("5"),
        )
        db.add(proj)
        await db.flush()
        db.add(ProjectUser(project_id=proj.id, user_id=pm1.id))

        # Some demo transactions (verified)
        cat_in = cats[0]
        cat_mat = cats[2]
        cat_op = cats[4]

        for d, amt, ctype, desc, ptype, pname in [
            (date.today() - timedelta(days=20), Decimal("100000000"), TxnType.IN, "Termin 1 dari client", PartyType.COMPANY, "PT Klien Sukses"),
            (date.today() - timedelta(days=15), Decimal("25000000"), TxnType.OUT, "Pembelian semen & besi", PartyType.COMPANY, "Toko Bangunan Sentosa"),
            (date.today() - timedelta(days=10), Decimal("8000000"), TxnType.OUT, "Upah tukang minggu 1", PartyType.PERSONAL, "Mandor Joko"),
            (date.today() - timedelta(days=5), Decimal("3500000"), TxnType.OUT, "Konsumsi dan transport", PartyType.INTERNAL, "Operasional Lapangan"),
        ]:
            t = Transaction(
                project_id=proj.id,
                tx_date=d,
                type=ctype,
                category_id=(cat_in.id if ctype == TxnType.IN else (cat_mat.id if "semen" in desc.lower() else cat_op.id)),
                amount=amt,
                party_type=ptype,
                party_name=pname,
                payment_method=PaymentMethod.TRANSFER,
                description=desc,
                status=TxnStatus.VERIFIED,
                created_by_id=admin.id,
                verified_by_id=admin.id,
            )
            db.add(t)

        # 1 invoice keluar (tagihan ke client) yang belum lunas
        inv = Invoice(
            number="INV/2026/04/PRJ-001/0001",
            project_id=proj.id,
            type=InvoiceType.OUT,
            invoice_date=date.today() - timedelta(days=2),
            due_date=date.today() + timedelta(days=14),
            vendor_client_id=vendors[2].id,
            party_name="PT Klien Sukses",
            subtotal=Decimal("150000000"),
            tax=Decimal("16500000"),
            total=Decimal("166500000"),
            status=InvoiceStatus.ISSUED,
            notes="Tagihan termin 2",
            created_by_id=admin.id,
        )
        inv.items.append(InvoiceItem(
            description="Pekerjaan struktur lantai 2",
            quantity=Decimal("1"), unit="lot",
            unit_price=Decimal("100000000"), subtotal=Decimal("100000000"),
        ))
        inv.items.append(InvoiceItem(
            description="Pekerjaan finishing dinding",
            quantity=Decimal("1"), unit="lot",
            unit_price=Decimal("50000000"), subtotal=Decimal("50000000"),
        ))
        db.add(inv)

        await db.commit()
        print("Seed applied. Login as admin@bintang.me / admin123 (or pm1@bintang.me / pm123)")


def main() -> None:
    asyncio.run(init())


if __name__ == "__main__":
    main()
