"""Shared session + resolver helpers utk bot doc flow (PO + Invoice).

Audit 2026-06-02: dipisahkan dari bot_po_assistant.py supaya pattern
session yg sama dipakai utk:
- PO text-based (audit 2026-05-30, /po + multi-line body)
- PO photo-based (audit 2026-06-02, /po + foto -> OCR)
- Invoice photo-based (audit 2026-06-02, /invoice + foto -> OCR)

Session model: BotPendingDocSession (lihat models/_auth.py). Satu row
aktif per (channel, chat_id) -- /po atau /invoice kedua overwrite
sesi sebelumnya.
"""
from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import user_project_ids
from app.models.models import (
    BotPendingDocSession,
    Project,
    ProjectStatus,
    User,
    VendorClient,
)

logger = logging.getLogger(__name__)


SESSION_TTL_MINUTES = 10
# Audit 2026-06-02: reminder 1 menit sebelum expired (= 9 menit setelah save).
REMINDER_DELAY_SECONDS = (SESSION_TTL_MINUTES - 1) * 60


class BotDocError(Exception):
    """Error yg siap di-render jadi reply user-friendly."""


# ---------- Resolver: project (scoped ke akses user, AKTIF only) ----------

async def resolve_project(
    db: AsyncSession, user: User, hint: str | None,
) -> Project | None:
    """Match hint ke Project: code exact case-insensitive, atau name ilike.
    None kalau hint kosong / tdk ketemu / user tdk punya akses."""
    if not hint:
        return None
    hint = hint.strip()
    pids = await user_project_ids(db, user)
    stmt = select(Project).where(
        Project.deleted_at.is_(None),
        Project.status == ProjectStatus.AKTIF,
    )
    if pids is not None:
        if not pids:
            return None
        stmt = stmt.where(Project.id.in_(pids))
    by_code = stmt.where(Project.code.ilike(hint))
    p = (await db.execute(by_code)).scalar_one_or_none()
    if p:
        return p
    by_name = stmt.where(Project.name.ilike(f"%{hint}%"))
    return (await db.execute(by_name)).scalar_one_or_none()


async def first_accessible_project(
    db: AsyncSession, user: User,
) -> Project | None:
    """Fallback proyek default: pertama yg user punya akses (AKTIF).
    Audit 2026-06-02: dipakai saat user kirim /invoice tanpa hint
    proyek -- bot tetap simpan DRAFT, user pindah di web kalau salah."""
    pids = await user_project_ids(db, user)
    stmt = (
        select(Project)
        .where(
            Project.deleted_at.is_(None),
            Project.status == ProjectStatus.AKTIF,
        )
        .order_by(Project.id)
        .limit(1)
    )
    if pids is not None:
        if not pids:
            return None
        stmt = stmt.where(Project.id.in_(pids))
    return (await db.execute(stmt)).scalar_one_or_none()


# ---------- Resolver: vendor (global master) ----------

async def resolve_vendor(
    db: AsyncSession, hint: str | None,
) -> tuple[int | None, str | None]:
    """Match hint ke VendorClient (global, tdk per-company).
    Return (vendor_client_id, vendor_name). Kalau tdk ketemu -> (None, hint)
    biar caller pakai hint sbg party string."""
    if not hint:
        return None, None
    hint = hint.strip()
    exact = await db.execute(
        select(VendorClient).where(
            VendorClient.deleted_at.is_(None),
            VendorClient.name.ilike(hint),
        )
    )
    v = exact.scalars().first()
    if v:
        return v.id, v.name
    partial = await db.execute(
        select(VendorClient).where(
            VendorClient.deleted_at.is_(None),
            VendorClient.name.ilike(f"%{hint}%"),
        )
    )
    v = partial.scalars().first()
    if v:
        return v.id, v.name
    return None, hint


# ---------- Session CRUD ----------

async def save_session(
    db: AsyncSession, *,
    channel: str,
    chat_id: str,
    user_id: int,
    entity_type: str,    # "PO" | "INVOICE"
    payload: dict,
) -> int:
    """Insert / replace session aktif utk (channel, chat_id).
    Return session.id supaya caller bisa schedule_reminder."""
    existing = (await db.execute(
        select(BotPendingDocSession).where(
            BotPendingDocSession.channel == channel,
            BotPendingDocSession.chat_id == chat_id,
        )
    )).scalar_one_or_none()
    if existing is not None:
        await db.delete(existing)
        await db.flush()
    row = BotPendingDocSession(
        channel=channel,
        chat_id=chat_id,
        user_id=user_id,
        entity_type=entity_type,
        payload_json=json.dumps(payload, default=str),
        expires_at=datetime.now(timezone.utc) + timedelta(minutes=SESSION_TTL_MINUTES),
    )
    db.add(row)
    await db.flush()
    return row.id


async def load_active_session(
    db: AsyncSession, *, channel: str, chat_id: str,
) -> BotPendingDocSession | None:
    """Ambil session aktif (belum expired) utk chat_id. None kalau tdk ada."""
    row = (await db.execute(
        select(BotPendingDocSession).where(
            BotPendingDocSession.channel == channel,
            BotPendingDocSession.chat_id == chat_id,
        )
    )).scalar_one_or_none()
    if row is None:
        return None
    if row.expires_at < datetime.now(timezone.utc):
        await db.delete(row)
        await db.flush()
        return None
    return row


async def delete_session(
    db: AsyncSession, session: BotPendingDocSession,
) -> None:
    await db.delete(session)
    await db.flush()


def parse_payload(session: BotPendingDocSession) -> dict:
    """Decode payload JSON dr session row."""
    return json.loads(session.payload_json)


# ---------- Reminder (audit 2026-06-02) ----------

def schedule_reminder(
    *, channel: str, chat_id: str, session_id: int,
    delay_seconds: int = REMINDER_DELAY_SECONDS,
) -> None:
    """Fire-and-forget reminder ke chat ~1 menit sebelum session expired.
    Kalau session sudah dihapus (confirm/batal) saat reminder fire,
    no-op. Tdk persist -- kalau server restart, reminder hilang
    (acceptable utk MVP).

    Pakai pola async.create_task(...) seperti _process_ocr_job di
    api/v1/ocr.py.
    """
    async def _runner():
        try:
            await asyncio.sleep(delay_seconds)
            from app.db.session import SessionLocal
            async with SessionLocal() as db:
                session = await db.get(BotPendingDocSession, session_id)
                if session is None:
                    return  # sudah confirmed/cancelled/replaced
                if session.expires_at < datetime.now(timezone.utc):
                    return  # somehow already expired
                entity = session.entity_type.lower()
                if channel == "whatsapp":
                    from app.services.whatsapp import client as wa
                    await wa.send_text(
                        chat_id,
                        f"⏰ Pengingat: ada draf {entity} menunggu konfirmasi. "
                        "Balas *ya* utk simpan sbg DRAFT atau *batal* utk batalkan. "
                        "Session expire dalam 1 menit.",
                    )
                elif channel == "telegram":
                    from app.services.telegram import client as tg
                    await tg.send_message(
                        chat_id,
                        f"⏰ <b>Pengingat</b>: ada draf {entity} menunggu konfirmasi. "
                        "Balas <b>ya</b> utk simpan sbg DRAFT atau <b>batal</b> "
                        "utk batalkan. Session expire dalam 1 menit.",
                    )
        except Exception as e:  # noqa: BLE001
            logger.warning("bot_doc reminder failed channel=%s sid=%s err=%s",
                           channel, session_id, e)

    asyncio.create_task(_runner())
