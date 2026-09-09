"""Clean / production seed: 1 superadmin + 12 default categories. Nothing else.

Run after fresh DB:
    python -m app.seed_master

Login default:
    admin@cacak.app / admin123  (UBAH password setelah login pertama!)
"""

from __future__ import annotations

import asyncio

from sqlalchemy import select

from app.core.security import hash_password
from app.db.base import Base
from app.db.session import SessionLocal, engine
from app.models.models import (
    Category,
    CategoryType,
    User,
    UserRole,
)

DEFAULT_CATEGORIES_IN: list[tuple[str, str | None]] = [
    ("Termin Proyek", "Pencairan termin dari client"),
    ("DP Client", "Down payment di awal proyek"),
    ("Retensi Cair", "Pencairan retensi setelah proyek selesai"),
    ("Pemasukan Lainnya", None),
]

DEFAULT_CATEGORIES_OUT: list[tuple[str, str | None]] = [
    ("Material Bangunan", "Semen, besi, pasir, dll"),
    ("Upah Tukang", "Upah pekerja harian/borongan"),
    ("Sewa Alat Berat", "Excavator, crane, scaffolding"),
    ("Subkontraktor", "Pembayaran ke subkon"),
    ("Operasional Lapangan", "Konsumsi, transport, BBM site"),
    ("Perizinan & Legal", "IMB, izin lingkungan, dll"),
    ("Konsultan & Desain", "Honor arsitek, MEP, struktur"),
    ("Listrik & Utilitas", "PLN, air, internet site"),
]


async def init() -> None:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with SessionLocal() as db:
        # 1. Superadmin
        existing_admin = (
            await db.execute(select(User).where(User.email == "admin@cacak.app"))
        ).scalar_one_or_none()

        if existing_admin is None:
            admin = User(
                email="admin@cacak.app",
                password_hash=hash_password("admin123"),
                name="Super Admin",
                role=UserRole.SUPERADMIN,
            )
            db.add(admin)
            print("✓ Superadmin dibuat: admin@cacak.app / admin123")
        else:
            print("• Superadmin sudah ada, dilewati.")

        # 2. Kategori master
        existing_cats = {
            c.name
            for c in (await db.execute(select(Category))).scalars().all()
        }
        added = 0
        for name, desc in DEFAULT_CATEGORIES_IN:
            if name in existing_cats:
                continue
            db.add(Category(name=name, type=CategoryType.IN, description=desc))
            added += 1
        for name, desc in DEFAULT_CATEGORIES_OUT:
            if name in existing_cats:
                continue
            db.add(Category(name=name, type=CategoryType.OUT, description=desc))
            added += 1
        print(f"✓ {added} kategori default ditambahkan ({len(existing_cats)} sudah ada).")

        await db.commit()
        print()
        print("=" * 60)
        print("Master seed selesai. Sistem siap dipakai.")
        print("Login: admin@cacak.app / admin123")
        print("WAJIB ganti password lewat menu Pengguna setelah login pertama.")
        print("=" * 60)


def main() -> None:
    asyncio.run(init())


if __name__ == "__main__":
    main()
