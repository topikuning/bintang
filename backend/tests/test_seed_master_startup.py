from sqlalchemy import select

from app.core.security import verify_password
from app.models.models import Category, User, UserRole
from app.seed_master import seed_session


async def test_startup_seed_creates_login_on_empty_database(db):
    await seed_session(db, startup=True)

    admin = (await db.execute(select(User).where(User.email == "admin@bintang.me"))).scalar_one()
    categories = (await db.execute(select(Category))).scalars().all()

    assert admin.role == UserRole.SUPERADMIN
    assert verify_password("admin123", admin.password_hash)
    assert len(categories) == 12


async def test_startup_seed_is_idempotent(db):
    await seed_session(db, startup=True)
    await seed_session(db, startup=True)

    users = (await db.execute(select(User))).scalars().all()
    categories = (await db.execute(select(Category))).scalars().all()

    assert len(users) == 1
    assert len(categories) == 12


async def test_startup_seed_does_not_add_known_account_to_used_database(db):
    db.add(
        User(
            email="owner@example.com",
            password_hash="existing-hash",
            name="Existing Owner",
            role=UserRole.SUPERADMIN,
        )
    )
    await db.commit()

    await seed_session(db, startup=True)

    users = (await db.execute(select(User))).scalars().all()
    assert [user.email for user in users] == ["owner@example.com"]
