"""Admin endpoint utk lihat + override prompt AI per feature.

Audit 2026-05-24 user req: SUPERADMIN bisa sesuaikan prompt tiap
command lewat menu Settings.

Sources of truth:
- Default: `services/ai/prompt_registry.FEATURES`
- Override: tabel `ai_prompt_overrides` (row baru kalau admin save).
"""
from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import require_superadmin
from app.db.session import get_db
from app.models.models import AIPromptOverride, User
from app.services.ai.prompt_registry import (
    FEATURES,
    extract_placeholders,
    validate_template,
)

router = APIRouter()


class PromptFieldOut(BaseModel):
    default: str
    current: str
    overridden: bool
    placeholders_required: list[str]
    placeholders_in_current: list[str]
    updated_by_id: int | None = None
    updated_at: datetime | None = None


class PromptFeatureOut(BaseModel):
    key: str
    label: str
    description: str
    system: PromptFieldOut
    user_template: PromptFieldOut | None  # None = feature tdk pakai user prompt


class PromptListOut(BaseModel):
    features: list[PromptFeatureOut]


class PromptUpdateIn(BaseModel):
    content: str


def _build_field(
    default: str,
    override_row: AIPromptOverride | None,
    required: tuple[str, ...],
) -> PromptFieldOut:
    current = override_row.content if override_row else default
    return PromptFieldOut(
        default=default,
        current=current,
        overridden=override_row is not None,
        placeholders_required=list(required),
        placeholders_in_current=sorted(extract_placeholders(current)),
        updated_by_id=override_row.updated_by_id if override_row else None,
        updated_at=override_row.updated_at if override_row else None,
    )


@router.get("/", response_model=PromptListOut)
async def list_prompts(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_superadmin),
) -> PromptListOut:
    """List semua feature + current prompt (default kalau blm di-override)."""
    rows = (await db.execute(select(AIPromptOverride))).scalars().all()
    overrides: dict[tuple[str, str], AIPromptOverride] = {
        (r.feature_key, r.field): r for r in rows
    }
    out_features: list[PromptFeatureOut] = []
    for spec in FEATURES.values():
        sys_field = _build_field(
            spec.system_default,
            overrides.get((spec.key, "system")),
            # System placeholders cuma di feature spesifik (ask_query).
            # Validasi: kalau ada, harus tetap ada di override.
            spec.system_placeholders,
        )
        usr_field: PromptFieldOut | None = None
        if spec.user_template_default:
            usr_field = _build_field(
                spec.user_template_default,
                overrides.get((spec.key, "user_template")),
                spec.user_placeholders,
            )
        out_features.append(PromptFeatureOut(
            key=spec.key,
            label=spec.label,
            description=spec.description,
            system=sys_field,
            user_template=usr_field,
        ))
    return PromptListOut(features=out_features)


def _required_for(feature_key: str, field: str) -> tuple[str, ...]:
    spec = FEATURES.get(feature_key)
    if spec is None:
        raise HTTPException(404, "feature_not_found")
    if field == "system":
        return spec.system_placeholders
    if field == "user_template":
        if not spec.user_template_default:
            raise HTTPException(409, "feature_has_no_user_template")
        return spec.user_placeholders
    raise HTTPException(400, "invalid_field")


@router.put("/{feature_key}/{field}", response_model=PromptFeatureOut)
async def upsert_prompt(
    feature_key: str,
    field: str,
    payload: PromptUpdateIn,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_superadmin),
) -> PromptFeatureOut:
    """Upsert override prompt utk (feature_key, field).

    Validasi: semua placeholder default WAJIB ada di content. Kalau
    hilang -> 400 dgn detail. (Mencegah feature crash di runtime.)
    """
    required = _required_for(feature_key, field)
    errs = validate_template(payload.content, required)
    if errs:
        raise HTTPException(
            status_code=400,
            detail={"code": "invalid_placeholders", "errors": errs},
        )
    row = (await db.execute(
        select(AIPromptOverride).where(
            AIPromptOverride.feature_key == feature_key,
            AIPromptOverride.field == field,
        )
    )).scalar_one_or_none()
    if row is None:
        row = AIPromptOverride(
            feature_key=feature_key, field=field,
            content=payload.content, updated_by_id=admin.id,
        )
        db.add(row)
    else:
        row.content = payload.content
        row.updated_by_id = admin.id
    await db.commit()
    return await _get_feature_out(db, feature_key)


@router.delete("/{feature_key}/{field}", response_model=PromptFeatureOut)
async def reset_prompt(
    feature_key: str,
    field: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_superadmin),
) -> PromptFeatureOut:
    """Reset ke default = hapus row override."""
    _required_for(feature_key, field)  # validate feature exists
    row = (await db.execute(
        select(AIPromptOverride).where(
            AIPromptOverride.feature_key == feature_key,
            AIPromptOverride.field == field,
        )
    )).scalar_one_or_none()
    if row is not None:
        await db.delete(row)
        await db.commit()
    return await _get_feature_out(db, feature_key)


async def _get_feature_out(db: AsyncSession, feature_key: str) -> PromptFeatureOut:
    spec = FEATURES[feature_key]
    rows = (await db.execute(
        select(AIPromptOverride).where(AIPromptOverride.feature_key == feature_key)
    )).scalars().all()
    overrides = {r.field: r for r in rows}
    sys_field = _build_field(
        spec.system_default, overrides.get("system"), spec.system_placeholders,
    )
    usr_field: PromptFieldOut | None = None
    if spec.user_template_default:
        usr_field = _build_field(
            spec.user_template_default,
            overrides.get("user_template"),
            spec.user_placeholders,
        )
    return PromptFeatureOut(
        key=spec.key, label=spec.label, description=spec.description,
        system=sys_field, user_template=usr_field,
    )
