"""Rich demo seed data: 3 companies, 5 projects (varied budget states),
4 users, multiple categories/vendors, ~30 transactions, 6 invoices, 3 POs.

Run after fresh DB:
    python -m app.seed
"""

from __future__ import annotations

import asyncio
from datetime import date, datetime, timedelta, timezone
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
    POItem,
    POStatus,
    Project,
    ProjectStatus,
    ProjectUser,
    PurchaseOrder,
    Transaction,
    TxnStatus,
    TxnType,
    User,
    UserRole,
    VendorClient,
    VendorClientType,
)

today = date.today()


def d(days_ago: int) -> date:
    return today - timedelta(days=days_ago)


async def init() -> None:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with SessionLocal() as db:
        existing = (
            await db.execute(select(User).where(User.email == "admin@bintang.me"))
        ).scalar_one_or_none()
        if existing:
            print("Seed already applied. Skipping.")
            return

        # ---------- Users ----------
        admin = User(
            email="admin@bintang.me",
            password_hash=hash_password("admin123"),
            name="Super Admin",
            role=UserRole.SUPERADMIN,
            phone="0811-1000-001",
        )
        pm1 = User(
            email="budi@bintang.me",
            password_hash=hash_password("pm123"),
            name="Budi Santoso",
            role=UserRole.PROJECT_ADMIN,
            phone="0812-2000-002",
        )
        pm2 = User(
            email="sari@bintang.me",
            password_hash=hash_password("pm123"),
            name="Sari Dewi",
            role=UserRole.PROJECT_ADMIN,
            phone="0813-3000-003",
        )
        pm3 = User(
            email="agus@bintang.me",
            password_hash=hash_password("pm123"),
            name="Agus Pratama",
            role=UserRole.PROJECT_ADMIN,
            phone="0814-4000-004",
        )
        db.add_all([admin, pm1, pm2, pm3])
        await db.flush()

        # ---------- Companies ----------
        bka = Company(
            name="PT Bintang Karya Abadi",
            address="Jl. Sudirman No. 88, Jakarta Pusat",
            npwp="01.234.567.8-091.000",
            phone="021-5550-1234",
            email="info@bka.co.id",
            director_name="Ir. Hendra Wijaya",
            bank_account="BCA 123-456-7890 a.n. PT Bintang Karya Abadi",
        )
        mandiri = Company(
            name="CV Mandiri Sejahtera",
            address="Jl. Asia Afrika No. 15, Bandung",
            npwp="02.345.678.9-091.000",
            phone="022-4400-2345",
            email="cs@mandirisejahtera.co.id",
            director_name="Ahmad Hidayat",
            bank_account="Mandiri 987-654-3210 a.n. CV Mandiri Sejahtera",
        )
        nusantara = Company(
            name="PT Nusantara Konstruksi",
            address="Jl. Gatot Subroto Km 3, Surabaya",
            npwp="03.456.789.0-091.000",
            phone="031-7800-3456",
            email="kontak@nusantara-k.co.id",
            director_name="Dr. Rini Lestari",
            bank_account="BNI 555-111-2222 a.n. PT Nusantara Konstruksi",
        )
        db.add_all([bka, mandiri, nusantara])
        await db.flush()

        # ---------- Categories ----------
        cats_in = [
            Category(name="Termin Proyek", type=CategoryType.IN, description="Pencairan termin dari client"),
            Category(name="DP Client", type=CategoryType.IN, description="Down payment di awal proyek"),
            Category(name="Retensi Cair", type=CategoryType.IN),
            Category(name="Pemasukan Lainnya", type=CategoryType.IN),
        ]
        cats_out = [
            Category(name="Material Bangunan", type=CategoryType.OUT),
            Category(name="Upah Tukang", type=CategoryType.OUT),
            Category(name="Sewa Alat Berat", type=CategoryType.OUT),
            Category(name="Subkontraktor", type=CategoryType.OUT),
            Category(name="Operasional Lapangan", type=CategoryType.OUT, description="Konsumsi, transport, BBM"),
            Category(name="Perizinan & Legal", type=CategoryType.OUT),
            Category(name="Konsultan & Desain", type=CategoryType.OUT),
            Category(name="Listrik & Utilitas", type=CategoryType.OUT),
        ]
        db.add_all(cats_in + cats_out)
        await db.flush()

        c_termin, c_dp, c_retensi, c_lain = cats_in
        c_material, c_upah, c_alat, c_sub, c_oper, c_izin, c_konsultan, c_listrik = cats_out

        # ---------- Vendors / Clients ----------
        v_sentosa = VendorClient(name="Toko Bangunan Sentosa", type=VendorClientType.VENDOR,
                                 phone="021-5511-1111", contact="Pak Joko",
                                 bank_account="BCA 222-111-3333")
        v_beton = VendorClient(name="CV Mitra Beton Pratama", type=VendorClientType.VENDOR,
                               phone="021-7700-2222", npwp="04.111.222.3-091.000",
                               contact="Bu Yanti")
        v_alat = VendorClient(name="PT Sewa Alat Jaya", type=VendorClientType.VENDOR,
                              phone="031-8800-3333", contact="Pak Hadi")
        v_subkon = VendorClient(name="CV Karya Mandiri Subkon", type=VendorClientType.VENDOR,
                                phone="022-9900-4444", contact="Pak Rizal")
        c_sukses = VendorClient(name="PT Klien Sukses Makmur", type=VendorClientType.CLIENT,
                                phone="021-1111-5555", contact="Bp. Tanto",
                                npwp="05.222.333.4-091.000")
        c_persada = VendorClient(name="PT Persada Properti", type=VendorClientType.CLIENT,
                                 phone="021-2222-6666", contact="Ibu Siska")
        c_griya = VendorClient(name="Griya Asri Group", type=VendorClientType.CLIENT,
                               phone="022-3333-7777", contact="Bp. Doni")
        db.add_all([v_sentosa, v_beton, v_alat, v_subkon, c_sukses, c_persada, c_griya])
        await db.flush()

        # ---------- Projects (5, varied budget states) ----------
        # 1. PRJ-001 - sehat, healthy cashflow, BKA
        p1 = Project(
            code="PRJ-001",
            name="Renovasi Gedung Pusat Sudirman",
            location="Jakarta Pusat",
            company_id=bka.id,
            pic_user_id=pm1.id,
            start_date=d(60),
            end_date=today + timedelta(days=120),
            status=ProjectStatus.AKTIF,
            notes="Proyek renovasi 4 lantai gedung pusat klien Sukses Makmur.",
            budget_amount=Decimal("500000000"),
            currency="IDR",
            overbudget_tolerance_pct=Decimal("5"),
        )
        # 2. PRJ-002 - mendekati batas budget, BKA
        p2 = Project(
            code="PRJ-002",
            name="Pembangunan Ruko Kemang",
            location="Jakarta Selatan",
            company_id=bka.id,
            pic_user_id=pm1.id,
            start_date=d(45),
            end_date=today + timedelta(days=90),
            status=ProjectStatus.AKTIF,
            notes="3 unit ruko untuk PT Persada Properti.",
            budget_amount=Decimal("300000000"),
            currency="IDR",
            overbudget_tolerance_pct=Decimal("10"),
        )
        # 3. PRJ-003 - overbudget, Mandiri
        p3 = Project(
            code="PRJ-003",
            name="Renovasi Pabrik Cikarang",
            location="Bekasi",
            company_id=mandiri.id,
            pic_user_id=pm2.id,
            start_date=d(80),
            end_date=today + timedelta(days=30),
            status=ProjectStatus.AKTIF,
            notes="Renovasi area produksi, scope membengkak.",
            budget_amount=Decimal("200000000"),
            currency="IDR",
            overbudget_tolerance_pct=Decimal("0"),
        )
        # 4. PRJ-004 - kecil, sehat, Mandiri
        p4 = Project(
            code="PRJ-004",
            name="Furniture Custom Office Dago",
            location="Bandung",
            company_id=mandiri.id,
            pic_user_id=pm2.id,
            start_date=d(20),
            end_date=today + timedelta(days=20),
            status=ProjectStatus.AKTIF,
            notes="Furniture interior kantor 2 lantai Griya Asri.",
            budget_amount=Decimal("80000000"),
            currency="IDR",
            overbudget_tolerance_pct=Decimal("5"),
        )
        # 5. PRJ-005 - minus saldo, Nusantara
        p5 = Project(
            code="PRJ-005",
            name="Apartemen Tower B Lantai 5-10",
            location="Surabaya",
            company_id=nusantara.id,
            pic_user_id=pm3.id,
            start_date=d(90),
            end_date=today + timedelta(days=180),
            status=ProjectStatus.AKTIF,
            notes="Pembiayaan termin client tertunda; talangan kontraktor.",
            budget_amount=Decimal("1500000000"),
            currency="IDR",
            overbudget_tolerance_pct=Decimal("8"),
        )
        db.add_all([p1, p2, p3, p4, p5])
        await db.flush()

        # Project assignments (PMs hanya boleh akses proyek-nya sendiri)
        db.add_all([
            ProjectUser(project_id=p1.id, user_id=pm1.id),
            ProjectUser(project_id=p2.id, user_id=pm1.id),
            ProjectUser(project_id=p3.id, user_id=pm2.id),
            ProjectUser(project_id=p4.id, user_id=pm2.id),
            ProjectUser(project_id=p5.id, user_id=pm3.id),
        ])

        # ---------- Transactions helper ----------
        def tx(
            project, days_ago, ttype, cat, amount, party_name,
            party_type=PartyType.COMPANY, vc=None, method=PaymentMethod.TRANSFER,
            status=TxnStatus.VERIFIED, desc=None, ref=None, by=admin,
        ) -> Transaction:
            t = Transaction(
                project_id=project.id,
                tx_date=d(days_ago),
                type=ttype,
                category_id=cat.id if cat else None,
                amount=Decimal(str(amount)),
                party_type=party_type,
                party_name=party_name,
                vendor_client_id=vc.id if vc else None,
                payment_method=method,
                reference_no=ref,
                description=desc,
                status=status,
                created_by_id=by.id,
            )
            if status == TxnStatus.VERIFIED:
                t.verified_by_id = admin.id
                t.verified_at = datetime.now(timezone.utc)
            return t

        all_txs: list[Transaction] = []

        # PRJ-001 (sehat): in 250jt, out ~180jt → saldo +70jt, budget 500jt → 36% pakai
        all_txs += [
            tx(p1, 55, TxnType.IN, c_dp, 100_000_000, "PT Klien Sukses Makmur", vc=c_sukses,
               desc="DP 30% proyek renovasi", ref="TRF-DP-001"),
            tx(p1, 30, TxnType.IN, c_termin, 150_000_000, "PT Klien Sukses Makmur", vc=c_sukses,
               desc="Termin 1", ref="TRF-T1-001"),
            tx(p1, 50, TxnType.OUT, c_material, 45_000_000, "Toko Bangunan Sentosa", vc=v_sentosa,
               desc="Pembelian semen, besi, pasir tahap 1"),
            tx(p1, 40, TxnType.OUT, c_upah, 25_000_000, "Mandor Joko & Tim", party_type=PartyType.PERSONAL,
               desc="Upah tukang minggu 1-2", method=PaymentMethod.CASH),
            tx(p1, 25, TxnType.OUT, c_material, 32_000_000, "CV Mitra Beton Pratama", vc=v_beton,
               desc="Beton ready mix K-300"),
            tx(p1, 20, TxnType.OUT, c_alat, 15_000_000, "PT Sewa Alat Jaya", vc=v_alat,
               desc="Sewa scaffolding 1 bulan"),
            tx(p1, 15, TxnType.OUT, c_upah, 30_000_000, "Mandor Joko & Tim", party_type=PartyType.PERSONAL,
               desc="Upah tukang minggu 3-4"),
            tx(p1, 10, TxnType.OUT, c_oper, 8_500_000, "Operasional Lapangan", party_type=PartyType.INTERNAL,
               desc="Konsumsi, transport, BBM"),
            tx(p1, 5, TxnType.OUT, c_konsultan, 12_000_000, "Arsitek Wijaya", party_type=PartyType.PERSONAL,
               desc="Honor konsultan struktur"),
            tx(p1, 2, TxnType.OUT, c_material, 14_000_000, "Toko Bangunan Sentosa", vc=v_sentosa,
               desc="Cat tembok premium 200kg"),
            # 1 transaksi masih SUBMITTED untuk demo workflow
            tx(p1, 1, TxnType.OUT, c_oper, 2_500_000, "Operasional", party_type=PartyType.INTERNAL,
               desc="BBM dan transport tukang", status=TxnStatus.SUBMITTED, by=pm1),
        ]

        # PRJ-002 (mendekati batas): out 260jt dari budget 300jt = 86%
        all_txs += [
            tx(p2, 40, TxnType.IN, c_dp, 90_000_000, "PT Persada Properti", vc=c_persada,
               desc="DP 30% pembangunan ruko"),
            tx(p2, 20, TxnType.IN, c_termin, 120_000_000, "PT Persada Properti", vc=c_persada,
               desc="Termin 1 (struktur selesai)"),
            tx(p2, 38, TxnType.OUT, c_material, 60_000_000, "Toko Bangunan Sentosa", vc=v_sentosa,
               desc="Material struktur tahap awal"),
            tx(p2, 33, TxnType.OUT, c_alat, 25_000_000, "PT Sewa Alat Jaya", vc=v_alat,
               desc="Sewa excavator 2 minggu"),
            tx(p2, 28, TxnType.OUT, c_sub, 70_000_000, "CV Karya Mandiri Subkon", vc=v_subkon,
               desc="Subkon pekerjaan pondasi"),
            tx(p2, 18, TxnType.OUT, c_material, 55_000_000, "CV Mitra Beton Pratama", vc=v_beton,
               desc="Beton & besi struktur lt 1"),
            tx(p2, 10, TxnType.OUT, c_upah, 28_000_000, "Mandor Asep & Tim", party_type=PartyType.PERSONAL,
               desc="Upah tukang bulan 1"),
            tx(p2, 5, TxnType.OUT, c_oper, 12_000_000, "Operasional Lapangan", party_type=PartyType.INTERNAL,
               desc="Konsumsi & transport"),
            tx(p2, 3, TxnType.OUT, c_izin, 10_000_000, "Pengurusan IMB", party_type=PartyType.OTHER,
               desc="Biaya pengurusan izin tambahan"),
        ]

        # PRJ-003 (OVERBUDGET): out 240jt, budget 200jt = 120%
        all_txs += [
            tx(p3, 75, TxnType.IN, c_dp, 60_000_000, "PT Klien Industri Maju", vc=None,
               party_name="PT Klien Industri Maju",
               desc="DP renovasi pabrik"),
            tx(p3, 50, TxnType.IN, c_termin, 80_000_000, "PT Klien Industri Maju",
               desc="Termin 1"),
            tx(p3, 70, TxnType.OUT, c_material, 50_000_000, "Toko Bangunan Sentosa", vc=v_sentosa,
               desc="Material atap & rangka baja"),
            tx(p3, 60, TxnType.OUT, c_sub, 80_000_000, "CV Karya Mandiri Subkon", vc=v_subkon,
               desc="Subkon pekerjaan baja"),
            tx(p3, 45, TxnType.OUT, c_alat, 18_000_000, "PT Sewa Alat Jaya", vc=v_alat,
               desc="Sewa crane 2 minggu"),
            tx(p3, 30, TxnType.OUT, c_material, 40_000_000, "CV Mitra Beton Pratama", vc=v_beton,
               desc="Tambahan struktur (scope berubah)"),
            tx(p3, 15, TxnType.OUT, c_upah, 35_000_000, "Mandor Bambang", party_type=PartyType.PERSONAL,
               desc="Upah tukang"),
            tx(p3, 8, TxnType.OUT, c_listrik, 17_000_000, "PLN", party_type=PartyType.OTHER,
               desc="Biaya pasang baru daya listrik 23 KVA"),
        ]

        # PRJ-004 (sehat kecil): in 50jt, out 30jt → saldo +20jt, budget 80jt = 37%
        all_txs += [
            tx(p4, 18, TxnType.IN, c_dp, 50_000_000, "Griya Asri Group", vc=c_griya,
               desc="DP 50% furniture custom"),
            tx(p4, 15, TxnType.OUT, c_material, 18_000_000, "Toko Bangunan Sentosa", vc=v_sentosa,
               desc="Plywood, melamin, hardware"),
            tx(p4, 8, TxnType.OUT, c_upah, 8_000_000, "Tukang Furniture", party_type=PartyType.EMPLOYEE,
               desc="Upah workshop"),
            tx(p4, 3, TxnType.OUT, c_oper, 4_000_000, "Operasional", party_type=PartyType.INTERNAL,
               desc="Pengiriman & instalasi"),
        ]

        # PRJ-005 (minus): in 200jt, out 350jt → saldo -150jt
        all_txs += [
            tx(p5, 85, TxnType.IN, c_dp, 200_000_000, "Klien Apartemen Tower",
               desc="DP awal (terlambat dari termin lain)"),
            tx(p5, 80, TxnType.OUT, c_sub, 120_000_000, "CV Karya Mandiri Subkon", vc=v_subkon,
               desc="Subkon pekerjaan plat lantai 5-7"),
            tx(p5, 70, TxnType.OUT, c_material, 90_000_000, "CV Mitra Beton Pratama", vc=v_beton,
               desc="Beton ready mix volume besar"),
            tx(p5, 50, TxnType.OUT, c_alat, 40_000_000, "PT Sewa Alat Jaya", vc=v_alat,
               desc="Sewa tower crane 1 bulan"),
            tx(p5, 30, TxnType.OUT, c_upah, 60_000_000, "Mandor Tim Apartemen", party_type=PartyType.PERSONAL,
               desc="Upah tukang 2 bulan"),
            tx(p5, 14, TxnType.OUT, c_material, 40_000_000, "Toko Bangunan Sentosa", vc=v_sentosa,
               desc="Material finishing tahap 1"),
            # draft transaction
            tx(p5, 1, TxnType.OUT, c_oper, 5_500_000, "Operasional Site", party_type=PartyType.INTERNAL,
               desc="BBM, transport, konsumsi - menunggu verifikasi",
               status=TxnStatus.DRAFT, by=pm3),
        ]

        db.add_all(all_txs)
        await db.flush()

        # ---------- Invoices ----------
        # Invoice OUT (piutang) - sebagian PAID, sebagian PARTIALLY_PAID, satu OVERDUE
        # 1. PRJ-001 - termin 2 issued (belum dibayar) - on track
        inv1 = Invoice(
            number="INV/2026/04/PRJ-001/0001",
            project_id=p1.id, type=InvoiceType.OUT,
            invoice_date=d(5), due_date=today + timedelta(days=20),
            vendor_client_id=c_sukses.id, party_name="PT Klien Sukses Makmur",
            status=InvoiceStatus.ISSUED,
            notes="Tagihan termin 2 setelah progress 60%.",
            created_by_id=admin.id,
        )
        inv1.items.append(InvoiceItem(description="Pekerjaan struktur lantai 2-3",
                                      quantity=Decimal("1"), unit="lot",
                                      unit_price=Decimal("100000000"),
                                      subtotal=Decimal("100000000")))
        inv1.items.append(InvoiceItem(description="Finishing dinding & lantai",
                                      quantity=Decimal("1"), unit="lot",
                                      unit_price=Decimal("50000000"),
                                      subtotal=Decimal("50000000")))
        inv1.subtotal = Decimal("150000000")
        inv1.tax = Decimal("16500000")
        inv1.total = Decimal("166500000")

        # 2. PRJ-002 - sudah PAID
        inv2 = Invoice(
            number="INV/2026/03/PRJ-002/0001",
            project_id=p2.id, type=InvoiceType.OUT,
            invoice_date=d(35), due_date=d(20),
            vendor_client_id=c_persada.id, party_name="PT Persada Properti",
            status=InvoiceStatus.PAID,
            notes="Invoice DP, sudah lunas.",
            created_by_id=admin.id,
        )
        inv2.items.append(InvoiceItem(description="DP 30% pembangunan ruko 3 unit",
                                      quantity=Decimal("1"), unit="lot",
                                      unit_price=Decimal("90000000"),
                                      subtotal=Decimal("90000000")))
        inv2.subtotal = Decimal("90000000")
        inv2.total = Decimal("90000000")

        # 3. PRJ-002 - termin 1 PARTIALLY_PAID
        inv3 = Invoice(
            number="INV/2026/04/PRJ-002/0002",
            project_id=p2.id, type=InvoiceType.OUT,
            invoice_date=d(22), due_date=today + timedelta(days=10),
            vendor_client_id=c_persada.id, party_name="PT Persada Properti",
            status=InvoiceStatus.PARTIALLY_PAID,
            notes="Termin 1 - sudah dibayar 120jt dari 150jt.",
            created_by_id=admin.id,
        )
        inv3.items.append(InvoiceItem(description="Pekerjaan struktur 3 unit ruko",
                                      quantity=Decimal("3"), unit="unit",
                                      unit_price=Decimal("50000000"),
                                      subtotal=Decimal("150000000")))
        inv3.subtotal = Decimal("150000000")
        inv3.total = Decimal("150000000")

        # 4. PRJ-005 - OVERDUE (klien apartemen)
        inv4 = Invoice(
            number="INV/2026/02/PRJ-005/0001",
            project_id=p5.id, type=InvoiceType.OUT,
            invoice_date=d(60), due_date=d(20),
            party_name="Klien Apartemen Tower",
            status=InvoiceStatus.OVERDUE,
            notes="Termin 2 - melewati jatuh tempo, perlu follow-up.",
            created_by_id=admin.id,
        )
        inv4.items.append(InvoiceItem(description="Pekerjaan struktur lantai 5-7",
                                      quantity=Decimal("3"), unit="lantai",
                                      unit_price=Decimal("100000000"),
                                      subtotal=Decimal("300000000")))
        inv4.subtotal = Decimal("300000000")
        inv4.tax = Decimal("33000000")
        inv4.total = Decimal("333000000")

        # 5. Invoice IN (hutang ke vendor) - PAID
        inv5 = Invoice(
            number="VND/2026/03/PRJ-001/0001",
            project_id=p1.id, type=InvoiceType.IN,
            invoice_date=d(50), due_date=d(35),
            vendor_client_id=v_sentosa.id, party_name="Toko Bangunan Sentosa",
            status=InvoiceStatus.PAID,
            notes="Invoice material tahap 1, sudah dibayar.",
            created_by_id=admin.id,
        )
        inv5.items.append(InvoiceItem(description="Semen Tiga Roda 50kg",
                                      quantity=Decimal("400"), unit="sak",
                                      unit_price=Decimal("75000"),
                                      subtotal=Decimal("30000000")))
        inv5.items.append(InvoiceItem(description="Besi beton diameter 12mm",
                                      quantity=Decimal("150"), unit="batang",
                                      unit_price=Decimal("100000"),
                                      subtotal=Decimal("15000000")))
        inv5.subtotal = Decimal("45000000")
        inv5.total = Decimal("45000000")

        # 6. Invoice IN OVERDUE
        inv6 = Invoice(
            number="VND/2026/03/PRJ-003/0001",
            project_id=p3.id, type=InvoiceType.IN,
            invoice_date=d(40), due_date=d(10),
            vendor_client_id=v_subkon.id, party_name="CV Karya Mandiri Subkon",
            status=InvoiceStatus.OVERDUE,
            notes="Termin subkon, jatuh tempo terlewat.",
            created_by_id=admin.id,
        )
        inv6.items.append(InvoiceItem(description="Subkon pekerjaan baja & atap",
                                      quantity=Decimal("1"), unit="lot",
                                      unit_price=Decimal("80000000"),
                                      subtotal=Decimal("80000000")))
        inv6.subtotal = Decimal("80000000")
        inv6.total = Decimal("80000000")

        db.add_all([inv1, inv2, inv3, inv4, inv5, inv6])
        await db.flush()

        # Link some payments to invoices
        # inv2 (PAID 90jt) - link to the PRJ-002 DP transaction
        for t in all_txs:
            if t.project_id == p2.id and t.type == TxnType.IN and t.amount == Decimal("90000000"):
                t.invoice_id = inv2.id
        # inv3 (PARTIALLY_PAID) - link to 120jt termin
        for t in all_txs:
            if t.project_id == p2.id and t.type == TxnType.IN and t.amount == Decimal("120000000"):
                t.invoice_id = inv3.id
        # inv5 PAID (vendor sentosa) - link to one of the material payments to Sentosa
        for t in all_txs:
            if (t.project_id == p1.id and t.type == TxnType.OUT
                    and t.amount == Decimal("45000000")):
                t.invoice_id = inv5.id

        # ---------- Purchase Orders ----------
        po1 = PurchaseOrder(
            number=f"PO/{today.year}/{today.month:02d}/PRJ-001/0001",
            project_id=p1.id, company_id=bka.id,
            vendor_client_id=v_beton.id, vendor_name="CV Mitra Beton Pratama",
            po_date=d(28), needed_date=d(20),
            payment_terms="NET 30 setelah barang diterima",
            notes="Pengiriman ke site Sudirman.",
            status=POStatus.APPROVED,
            created_by_id=admin.id,
            approved_by_id=admin.id,
            approved_at=datetime.now(timezone.utc),
        )
        po1.items.append(POItem(description="Beton K-300 ready mix",
                                quantity=Decimal("80"), unit="m3",
                                unit_price=Decimal("400000"),
                                subtotal=Decimal("32000000")))
        po1.subtotal = Decimal("32000000")
        po1.total = Decimal("32000000")

        po2 = PurchaseOrder(
            number=f"PO/{today.year}/{today.month:02d}/PRJ-002/0001",
            project_id=p2.id, company_id=bka.id,
            vendor_client_id=v_sentosa.id, vendor_name="Toko Bangunan Sentosa",
            po_date=d(15), needed_date=d(10),
            payment_terms="50% DP, 50% setelah pengiriman",
            status=POStatus.ISSUED,
            created_by_id=pm1.id,
        )
        po2.items.append(POItem(description="Bata ringan AAC 7.5cm",
                                quantity=Decimal("1500"), unit="pcs",
                                unit_price=Decimal("12000"),
                                subtotal=Decimal("18000000")))
        po2.items.append(POItem(description="Mortar perekat",
                                quantity=Decimal("100"), unit="sak",
                                unit_price=Decimal("85000"),
                                subtotal=Decimal("8500000")))
        po2.subtotal = Decimal("26500000")
        po2.total = Decimal("26500000")

        po3 = PurchaseOrder(
            number=f"PO/{today.year}/{today.month:02d}/PRJ-005/0001",
            project_id=p5.id, company_id=nusantara.id,
            vendor_client_id=v_alat.id, vendor_name="PT Sewa Alat Jaya",
            po_date=d(40), needed_date=d(35),
            payment_terms="Bayar di muka 1 bulan",
            status=POStatus.FULFILLED,
            created_by_id=admin.id,
            approved_by_id=admin.id,
            approved_at=datetime.now(timezone.utc),
        )
        po3.items.append(POItem(description="Sewa Tower Crane 50m",
                                quantity=Decimal("1"), unit="bulan",
                                unit_price=Decimal("40000000"),
                                subtotal=Decimal("40000000")))
        po3.subtotal = Decimal("40000000")
        po3.total = Decimal("40000000")

        db.add_all([po1, po2, po3])

        await db.commit()

        print("=" * 60)
        print("Seed sukses!")
        print("=" * 60)
        print("Login:")
        print("  Superadmin     : admin@bintang.me / admin123")
        print("  PM Budi (PRJ1,2): budi@bintang.me / pm123")
        print("  PM Sari (PRJ3,4): sari@bintang.me / pm123")
        print("  PM Agus (PRJ5)  : agus@bintang.me / pm123")
        print()
        print("Demo data: 3 perusahaan, 5 proyek, 12 kategori, 7 vendor/client,")
        print(f"           {len(all_txs)} transaksi, 6 invoice, 3 PO")
        print("Status proyek: SEHAT (PRJ-001, PRJ-004), WASPADA (PRJ-002),")
        print("               OVERBUDGET (PRJ-003), MINUS (PRJ-005)")
        print("=" * 60)


def main() -> None:
    asyncio.run(init())


if __name__ == "__main__":
    main()
