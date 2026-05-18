"""merge_funder_into_user_executive

Merge entitas `funders` ke `users` (role=EXECUTIVE).

Rationale: pendana adalah role eksekutif read-only. Sebelumnya:
- funders = master data tanpa user account (cuma id+name)
- EXECUTIVE = role user read-only (sudah ada)

Setelah merge:
- 1 table users (role=EXECUTIVE) menampung pendana
- 1 link table project_users (sudah ada) menggantikan project_funders
- Pendana bisa login utk lihat dashboard project yg dia danai
- Admin kelola pendana lewat /master/users (filter role=EXECUTIVE)

## Strategi data migration (Q1 = A)
- Tiap Funder row -> User baru dgn:
  - email = `funder-{funder.id}@bintang.local` (placeholder unique)
  - full_name = funder.name
  - hashed_password = bcrypt random 32-char (effectively login disabled
    sampai admin reset). Kalau admin mau pendana login, set password
    ulang lewat Master User.
  - role = EXECUTIVE, scope_all_projects = False (Q4 = A, per-project)
  - is_active = True (Q2 = A, boleh login setelah reset password)
- Tiap project_funders row -> project_users (project_id, user_id=new id)
  UNLESS sudah ada link (user x project), skip (avoid unique violation)
- Drop project_funders, drop funders

Migration assume:
- bcrypt available via passlib (project dep)
- Email unique constraint di users ada (sudah ada di baseline)

Revision ID: f1a2b3c4d5e6
Revises: d05180aff149
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import secrets


revision: str = 'f1a2b3c4d5e6'
down_revision: Union[str, Sequence[str], None] = 'd05180aff149'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _hash_random_password() -> str:
    """Generate placeholder password hash. Unguessable -- user wajib
    minta admin reset via Master User sebelum bisa login.

    Pakai `bcrypt` langsung (dep eksplisit di pyproject.toml).
    Sebelumnya: passlib.context.CryptContext -- TIDAK ter-install di
    container, migration crash di production. Lihat
    app/core/security.py utk pattern yg konsisten dgn app runtime.
    """
    import bcrypt
    raw = secrets.token_urlsafe(32).encode("utf-8")
    return bcrypt.hashpw(raw, bcrypt.gensalt()).decode("utf-8")


def upgrade() -> None:
    conn = op.get_bind()

    # 1. Migrate funders -> users (role=EXECUTIVE)
    funders = conn.execute(
        sa.text("SELECT id, name FROM funders WHERE deleted_at IS NULL")
    ).fetchall()
    funder_to_user: dict[int, int] = {}
    for f in funders:
        funder_id = f[0]
        funder_name = f[1]
        email = f"funder-{funder_id}@bintang.local"
        # Pendana mungkin sudah ada sbg user (jarang, tapi safe-guard).
        existing = conn.execute(
            sa.text("SELECT id FROM users WHERE email = :em"),
            {"em": email},
        ).fetchone()
        if existing:
            funder_to_user[funder_id] = existing[0]
            continue
        pwd_hash = _hash_random_password()
        result = conn.execute(
            sa.text("""
                INSERT INTO users (
                    email, full_name, hashed_password, role,
                    scope_all_projects, is_active, created_at, updated_at
                ) VALUES (
                    :em, :fn, :pw, 'EXECUTIVE',
                    false, true, NOW(), NOW()
                ) RETURNING id
            """),
            {"em": email, "fn": funder_name, "pw": pwd_hash},
        )
        new_user_id = result.scalar_one()
        funder_to_user[funder_id] = new_user_id

    # 2. Migrate project_funders -> project_users
    pf_rows = conn.execute(
        sa.text("SELECT project_id, funder_id FROM project_funders WHERE deleted_at IS NULL")
    ).fetchall()
    for row in pf_rows:
        project_id = row[0]
        funder_id = row[1]
        user_id = funder_to_user.get(funder_id)
        if user_id is None:
            continue
        # Avoid unique violation kalau link sudah ada (mis. pendana
        # kebetulan sama email-nya dgn user existing di project).
        exists = conn.execute(
            sa.text("""
                SELECT 1 FROM project_users
                WHERE project_id = :pid AND user_id = :uid
            """),
            {"pid": project_id, "uid": user_id},
        ).fetchone()
        if exists:
            continue
        conn.execute(
            sa.text("""
                INSERT INTO project_users (project_id, user_id, created_at, updated_at)
                VALUES (:pid, :uid, NOW(), NOW())
            """),
            {"pid": project_id, "uid": user_id},
        )

    # 3. Drop tables (project_funders dulu krn FK)
    with op.batch_alter_table('project_funders', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_project_funders_funder_id'))
        batch_op.drop_index(batch_op.f('ix_project_funders_project_id'))
    op.drop_table('project_funders')

    with op.batch_alter_table('funders', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_funders_name'))
    op.drop_table('funders')


def downgrade() -> None:
    """Re-create tables. Data tidak di-restore (user EXECUTIVE bekas
    funder tetap ada -- aman, tidak destruktif terbalik)."""
    op.create_table(
        'funders',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(length=200), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_funders')),
    )
    with op.batch_alter_table('funders', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_funders_name'), ['name'], unique=True)

    op.create_table(
        'project_funders',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('project_id', sa.Integer(), nullable=False),
        sa.Column('funder_id', sa.Integer(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['funder_id'], ['funders.id'], name=op.f('fk_project_funders_funder_id_funders'), ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['project_id'], ['projects.id'], name=op.f('fk_project_funders_project_id_projects'), ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_project_funders')),
        sa.UniqueConstraint('project_id', 'funder_id', name=op.f('uq_project_funder')),
    )
    with op.batch_alter_table('project_funders', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_project_funders_funder_id'), ['funder_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_project_funders_project_id'), ['project_id'], unique=False)
