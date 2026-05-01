"""Endpoint MessagingConfig (toggle TG/WA dari halaman Pengaturan).

Detail koneksi (token, URL, secret) tetap di env. Endpoint ini hanya
mengelola toggle on/off + tampilkan ringkasan status integrasi sehingga
admin tahu apakah bot Telegram dan WAHA siap dipakai.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.deps import get_current_user, require_admin
from app.db.session import get_db
from app.models.models import User
from app.services import messaging
from app.services.telegram import client as tg
from app.services.whatsapp import client as wa

router = APIRouter()


class MessagingConfigOut(BaseModel):
    telegram_enabled: bool
    whatsapp_enabled: bool
    telegram_configured: bool
    whatsapp_configured: bool
    whatsapp_base_url: str | None = None
    whatsapp_session: str | None = None


class MessagingConfigPatch(BaseModel):
    telegram_enabled: bool | None = None
    whatsapp_enabled: bool | None = None


def _to_out(cfg) -> MessagingConfigOut:
    return MessagingConfigOut(
        telegram_enabled=cfg.telegram_enabled,
        whatsapp_enabled=cfg.whatsapp_enabled,
        telegram_configured=tg.is_enabled(),
        whatsapp_configured=wa.is_enabled(),
        whatsapp_base_url=settings.WHATSAPP_BASE_URL or None,
        whatsapp_session=settings.WHATSAPP_SESSION,
    )


@router.get("/config", response_model=MessagingConfigOut)
async def get_messaging_config(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
) -> MessagingConfigOut:
    cfg = await messaging.get_config(db)
    await db.commit()
    return _to_out(cfg)


@router.patch("/config", response_model=MessagingConfigOut)
async def patch_messaging_config(
    payload: MessagingConfigPatch,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
) -> MessagingConfigOut:
    cfg = await messaging.get_config(db)
    if payload.telegram_enabled is not None:
        cfg.telegram_enabled = payload.telegram_enabled
    if payload.whatsapp_enabled is not None:
        cfg.whatsapp_enabled = payload.whatsapp_enabled
    await db.commit()
    return _to_out(cfg)
