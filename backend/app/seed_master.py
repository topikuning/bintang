"""Clean / production seed: 1 superadmin + 12 default categories. Nothing else.

Startup container menjalankan mode aman secara otomatis. Untuk eksekusi
manual tetap tersedia:
    python -m app.seed_master

Mode startup hanya membuat akun default kalau tabel users benar-benar kosong,
sehingga deploy ulang tidak pernah menimpa atau menyisipkan akun ke database
yang sudah dipakai.

Login default:
    admin@bintang.me / admin123  (UBAH password setelah login pertama!)
"""

from __future__ import annotations

import asyncio
import sys

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

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


async def seed_session(db: AsyncSession, *, startup: bool = False) -> None:
    """Isi master data secara idempotent.

    Pada startup otomatis, kredensial default hanya boleh dibuat di database
    yang sama sekali belum punya user. Mode manual mempertahankan perilaku CLI
    lama: memastikan akun superadmin default tersedia.
    """
    existing_admin = (
        await db.execute(select(User).where(User.email == "admin@bintang.me"))
    ).scalar_one_or_none()
    has_any_user = (await db.execute(select(User.id).limit(1))).scalar_one_or_none() is not None

    if existing_admin is None:
        if not startup or not has_any_user:
            admin = User(
                email="admin@bintang.me",
                password_hash=hash_password("admin123"),
                name="Super Admin",
                role=UserRole.SUPERADMIN,
            )
            db.add(admin)
            print("✓ Superadmin dibuat: admin@bintang.me / admin123")
        else:
            print("• Database sudah memiliki user; akun default tidak dibuat.")
    else:
        print("• Superadmin sudah ada, dilewati.")

    existing_cats = {c.name for c in (await db.execute(select(Category))).scalars().all()}
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


async def init(*, startup: bool = False) -> None:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with SessionLocal() as db:
        await seed_session(db, startup=startup)

    print()
    print("=" * 60)
    print("Master seed selesai. Sistem siap dipakai.")
    if startup:
        print("Akun default hanya dibuat bila database belum memiliki user.")
    else:
        print("Login: admin@bintang.me / admin123")
    print("WAJIB ganti password lewat menu Pengguna setelah login pertama.")
    print("=" * 60)


def main() -> None:
    startup = "--startup" in sys.argv[1:]
    unknown = [arg for arg in sys.argv[1:] if arg != "--startup"]
    if unknown:
        raise SystemExit(f"Argumen tidak dikenal: {' '.join(unknown)}")
    asyncio.run(init(startup=startup))


if __name__ == "__main__":
    main()
