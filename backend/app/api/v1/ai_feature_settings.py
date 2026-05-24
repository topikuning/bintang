"""Admin endpoint utk per-feature AI runtime settings.

Audit 2026-05-24 user req: admin atur per fitur — provider, model,
budget, web_search, dst.

Default selalu di code (services/ai/feature_settings.DEFAULTS). Override
hanya kalau row di tabel `ai_feature_settings` ada.
"""
from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import require_superadmin
from app.db.session import get_db
from app.models.models import AIFeatureSettings, User
from app.services.ai.feature_settings import (
    DEFAULTS,
    SUPPORTED_MODELS,
    get_effective,
    monthly_spend_usd,
)
from app.services.ai.prompt_registry import FEATURES as PROMPT_FEATURES

router = APIRouter()


class FeatureSettingsOut(BaseModel):
    feature_key: str
    label: str
    description: str
    # Effective (merged) values
    provider: str | None
    model: str | None
    model_hint: str
    max_tokens: int
    cache_ttl_days: int
    rate_limit_per_min: int
    web_search_enabled: bool
    monthly_budget_usd: Decimal | None
    # Overridden field list (utk badge custom)
    overridden_fields: list[str]
    # Spending tracking
    monthly_spend_usd: Decimal
    # Default values (utk reset UI)
    defaults: dict
    updated_at: datetime | None = None
    updated_by_id: int | None = None


class FeatureSettingsListOut(BaseModel):
    features: list[FeatureSettingsOut]
    supported_models: list[dict]


class FeatureSettingsUpdateIn(BaseModel):
    """Semua field optional. Kirim null = reset field tsb ke default."""
    provider: str | None = None
    model: str | None = None
    max_tokens: int | None = Field(default=None, ge=1, le=200000)
    cache_ttl_days: int | None = Field(default=None, ge=0, le=365)
    rate_limit_per_min: int | None = Field(default=None, ge=1, le=10000)
    web_search_enabled: bool | None = None
    monthly_budget_usd: Decimal | None = Field(default=None, ge=0)


async def _build_out(
    db: AsyncSession, feature_key: str,
) -> FeatureSettingsOut:
    cfg = await get_effective(db, feature_key)
    row = (await db.execute(
        select(AIFeatureSettings).where(
            AIFeatureSettings.feature_key == feature_key,
        )
    )).scalar_one_or_none()
    prompt_spec = PROMPT_FEATURES.get(feature_key)
    spend = await monthly_spend_usd(db, feature_key)
    return FeatureSettingsOut(
        feature_key=feature_key,
        label=prompt_spec.label if prompt_spec else feature_key,
        description=prompt_spec.description if prompt_spec else "",
        provider=cfg.provider,
        model=cfg.model,
        model_hint=cfg.model_hint,
        max_tokens=cfg.max_tokens,
        cache_ttl_days=cfg.cache_ttl_days,
        rate_limit_per_min=cfg.rate_limit_per_min,
        web_search_enabled=cfg.web_search_enabled,
        monthly_budget_usd=cfg.monthly_budget_usd,
        overridden_fields=list(cfg.overridden_fields),
        monthly_spend_usd=spend,
        defaults=DEFAULTS.get(feature_key, {}),
        updated_at=row.updated_at if row else None,
        updated_by_id=row.updated_by_id if row else None,
    )


@router.get("/", response_model=FeatureSettingsListOut)
async def list_settings(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_superadmin),
) -> FeatureSettingsListOut:
    out = [await _build_out(db, k) for k in DEFAULTS.keys()]
    return FeatureSettingsListOut(
        features=out, supported_models=SUPPORTED_MODELS,
    )


@router.put("/{feature_key}", response_model=FeatureSettingsOut)
async def update_settings(
    feature_key: str,
    payload: FeatureSettingsUpdateIn,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_superadmin),
) -> FeatureSettingsOut:
    if feature_key not in DEFAULTS:
        raise HTTPException(404, "feature_not_found")
    # Validate provider value
    if payload.provider not in (None, "mistral", "claude"):
        raise HTTPException(400, "invalid_provider")
    # Validate model match provider
    if payload.model:
        m = next((m for m in SUPPORTED_MODELS if m["id"] == payload.model), None)
        if not m:
            raise HTTPException(400, "unknown_model")
        if payload.provider and payload.provider != m["provider"]:
            raise HTTPException(400, "model_provider_mismatch")
    row = (await db.execute(
        select(AIFeatureSettings).where(
            AIFeatureSettings.feature_key == feature_key,
        )
    )).scalar_one_or_none()
    if row is None:
        row = AIFeatureSettings(feature_key=feature_key)
        db.add(row)
    row.provider = payload.provider
    row.model = payload.model
    row.max_tokens = payload.max_tokens
    row.cache_ttl_days = payload.cache_ttl_days
    row.rate_limit_per_min = payload.rate_limit_per_min
    row.web_search_enabled = payload.web_search_enabled
    row.monthly_budget_usd = payload.monthly_budget_usd
    row.updated_by_id = admin.id
    await db.commit()
    return await _build_out(db, feature_key)


@router.delete("/{feature_key}", response_model=FeatureSettingsOut)
async def reset_settings(
    feature_key: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_superadmin),
) -> FeatureSettingsOut:
    """Reset ke default (hapus row override)."""
    if feature_key not in DEFAULTS:
        raise HTTPException(404, "feature_not_found")
    row = (await db.execute(
        select(AIFeatureSettings).where(
            AIFeatureSettings.feature_key == feature_key,
        )
    )).scalar_one_or_none()
    if row is not None:
        await db.delete(row)
        await db.commit()
    return await _build_out(db, feature_key)
