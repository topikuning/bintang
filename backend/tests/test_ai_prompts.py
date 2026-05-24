"""AI prompt registry + override endpoints. Audit 2026-05-24."""
from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient

from app.core.security import create_access_token, hash_password
from app.db.session import get_db
from app.main import app
from app.models.models import AIPromptOverride, User, UserRole
from app.services.ai.prompt_registry import (
    FEATURES,
    extract_placeholders,
    get_prompt,
    validate_template,
)


async def _seed_admin(db, role=UserRole.SUPERADMIN, email="s@x"):
    u = User(
        email=email, name="X", password_hash=hash_password("x"),
        role=role, scope_all_projects=True,
    )
    db.add(u); await db.flush()
    return u


def _hdr(user):
    return {"Authorization": f"Bearer {create_access_token(user.id, extra={'role': user.role.value})}"}


@pytest.fixture
def override_db(db):
    async def _gen():
        yield db
    app.dependency_overrides[get_db] = _gen
    yield
    app.dependency_overrides.pop(get_db, None)


# ---------- Registry helpers ----------

def test_extract_placeholders_basic():
    assert extract_placeholders("hello {a} world {b}") == {"a", "b"}
    # escape {{...}} dianggap literal
    assert extract_placeholders("{{not}} a {real}") == {"real"}


def test_validate_template_missing_placeholder():
    errs = validate_template("hello world", ("name",))
    assert errs and "name" in errs[0]


def test_validate_template_ok():
    assert validate_template("hello {name}", ("name",)) == []


def test_all_feature_defaults_self_valid():
    """Default template harus berisi semua placeholder yg di-declare."""
    for spec in FEATURES.values():
        if spec.user_template_default:
            errs = validate_template(
                spec.user_template_default, spec.user_placeholders,
            )
            assert not errs, f"{spec.key}: {errs}"
        if spec.system_placeholders:
            errs = validate_template(
                spec.system_default, spec.system_placeholders,
            )
            assert not errs, f"{spec.key} system: {errs}"


@pytest.mark.asyncio
async def test_get_prompt_returns_default(db):
    p = await get_prompt(db, "category")
    assert p.system.startswith("Kamu asisten finansial")
    assert "{ctx}" in p.user_template
    assert p.system_overridden is False
    assert p.user_overridden is False


@pytest.mark.asyncio
async def test_get_prompt_uses_override(db):
    admin = await _seed_admin(db)
    db.add(AIPromptOverride(
        feature_key="category", field="system",
        content="CUSTOM SYS {x}", updated_by_id=admin.id,
    ))
    await db.commit()
    p = await get_prompt(db, "category")
    assert p.system == "CUSTOM SYS {x}"
    assert p.system_overridden is True
    # user_template tetap default (tdk di-override)
    assert "{ctx}" in p.user_template
    assert p.user_overridden is False


# ---------- HTTP endpoints ----------

@pytest.mark.asyncio
async def test_list_prompts_superadmin(db, override_db):
    admin = await _seed_admin(db)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://t") as ac:
        r = await ac.get("/api/v1/ai-prompts/", headers=_hdr(admin))
    assert r.status_code == 200, r.text
    body = r.json()
    keys = {f["key"] for f in body["features"]}
    assert "category" in keys
    assert "anomaly" in keys
    # contract_extract tdk punya user_template
    contract = next(f for f in body["features"] if f["key"] == "contract_extract")
    assert contract["user_template"] is None


@pytest.mark.asyncio
async def test_list_prompts_central_admin_forbidden(db, override_db):
    central = await _seed_admin(db, role=UserRole.CENTRAL_ADMIN, email="c@x")
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://t") as ac:
        r = await ac.get("/api/v1/ai-prompts/", headers=_hdr(central))
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_upsert_prompt_valid(db, override_db):
    admin = await _seed_admin(db)
    transport = ASGITransport(app=app)
    new_content = (
        "Konteks transaksi:\n{ctx}\n\nPilihan kategori:\n{cats}\n\n"
        "PILIH BENAR (customized)."
    )
    async with AsyncClient(transport=transport, base_url="http://t") as ac:
        r = await ac.put(
            "/api/v1/ai-prompts/category/user_template",
            json={"content": new_content},
            headers=_hdr(admin),
        )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["user_template"]["overridden"] is True
    assert body["user_template"]["current"] == new_content


@pytest.mark.asyncio
async def test_upsert_prompt_missing_placeholder_rejected(db, override_db):
    admin = await _seed_admin(db)
    transport = ASGITransport(app=app)
    bad = "Tdk ada placeholder cats di sini, cuma {ctx}."
    async with AsyncClient(transport=transport, base_url="http://t") as ac:
        r = await ac.put(
            "/api/v1/ai-prompts/category/user_template",
            json={"content": bad},
            headers=_hdr(admin),
        )
    assert r.status_code == 400, r.text
    body = r.json()
    assert body["detail"]["code"] == "invalid_placeholders"


@pytest.mark.asyncio
async def test_reset_prompt(db, override_db):
    admin = await _seed_admin(db)
    db.add(AIPromptOverride(
        feature_key="category", field="system",
        content="CUSTOM", updated_by_id=admin.id,
    ))
    await db.commit()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://t") as ac:
        r = await ac.delete(
            "/api/v1/ai-prompts/category/system",
            headers=_hdr(admin),
        )
    assert r.status_code == 200, r.text
    assert r.json()["system"]["overridden"] is False
