"""SUPERADMIN tool: scan file uploads yg orphan (tdk ke-link entity manapun).

File di UPLOAD_DIR tetap ada walau parent (transaksi/invoice/proyek) hard-
deleted -- karena cascade hanya hapus row DB, bukan file di disk. Tool ini
list file orphan + opsi delete.
"""

from __future__ import annotations

import logging
import os
from pathlib import Path

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.deps import require_superadmin
from app.db.session import get_db
from app.models.models import (
    AIExtraction,
    AuditAction,
    CashAdvanceSettlementItem,
    Company,
    InvoiceAttachment,
    ProjectAttachment,
    TransactionAttachment,
    User,
)
from app.services.audit import log as audit_log

logger = logging.getLogger(__name__)

router = APIRouter()


def _walk_upload_dir() -> list[tuple[str, int, float]]:
    """Walk UPLOAD_DIR, return list of (relative_path, size_bytes, mtime).

    Relative path pakai forward-slash supaya match dgn url format `/files/...`.
    """
    base = Path(settings.UPLOAD_DIR)
    if not base.exists():
        return []
    items: list[tuple[str, int, float]] = []
    for root, _dirs, files in os.walk(base):
        for fname in files:
            p = Path(root) / fname
            try:
                stat = p.stat()
                rel = p.relative_to(base).as_posix()
                items.append((rel, stat.st_size, stat.st_mtime))
            except OSError:
                continue
    return items


async def _collect_referenced_urls(db: AsyncSession) -> set[str]:
    """SELECT semua url/path file dr semua tabel attachment. Convert ke
    relative_path (strip prefix /files/) utk match dgn walk result.
    """
    refs: set[str] = set()

    def add(url: str | None) -> None:
        if not url:
            return
        # External URL (Drive/Dropbox) skip
        if url.startswith("/files/"):
            refs.add(url[len("/files/") :])

    # ProjectAttachment.url
    res = await db.execute(select(ProjectAttachment.url))
    for (u,) in res.all():
        add(u)
    # TransactionAttachment.url
    res = await db.execute(select(TransactionAttachment.url))
    for (u,) in res.all():
        add(u)
    # InvoiceAttachment.url
    res = await db.execute(select(InvoiceAttachment.url))
    for (u,) in res.all():
        add(u)
    # CashAdvanceSettlementItem.receipt_url
    res = await db.execute(select(CashAdvanceSettlementItem.receipt_url))
    for (u,) in res.all():
        add(u)
    # Company.logo_url + letterhead_url
    res = await db.execute(select(Company.logo_url, Company.letterhead_url))
    for logo, letter in res.all():
        add(logo)
        add(letter)
    # AIExtraction.source_url (OCR uploads tracked di sini)
    res = await db.execute(select(AIExtraction.source_url))
    for (u,) in res.all():
        add(u)
    return refs


@router.get("")
async def list_orphan_files(
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(require_superadmin),
) -> dict:
    """Scan storage vs DB references. Return list file orphan dgn metadata.

    Response:
      {
        upload_dir, total_files, referenced_count, orphan_count,
        orphan_size_bytes, orphans: [{path, size_bytes, mtime, url}]
      }
    """
    all_files = _walk_upload_dir()
    refs = await _collect_referenced_urls(db)
    all_rels = {f[0] for f in all_files}
    orphan_paths = all_rels - refs
    orphans_meta = [
        {
            "path": rel,
            "size_bytes": size,
            "mtime": mtime,
            "url": f"/files/{rel}",
        }
        for rel, size, mtime in all_files
        if rel in orphan_paths
    ]
    # Sort by mtime desc (newest first -- helps spot recent issues)
    orphans_meta.sort(key=lambda x: x["mtime"], reverse=True)
    total_size = sum(o["size_bytes"] for o in orphans_meta)
    return {
        "upload_dir": str(settings.UPLOAD_DIR),
        "total_files": len(all_rels),
        "referenced_count": len(refs & all_rels),
        "orphan_count": len(orphans_meta),
        "orphan_size_bytes": total_size,
        "orphans": orphans_meta,
    }


@router.delete("")
async def delete_orphans(
    paths: list[str],
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_superadmin),
) -> dict:
    """Bulk delete orphan files. Re-validate orphan status per file sebelum
    delete (defense in depth -- file mungkin baru saja di-link).
    """
    base = Path(settings.UPLOAD_DIR).resolve()
    refs = await _collect_referenced_urls(db)
    deleted: list[str] = []
    skipped: list[dict] = []
    for rel in paths:
        # Sanitize: tdk boleh keluar dr UPLOAD_DIR
        target = (base / rel).resolve()
        try:
            target.relative_to(base)
        except ValueError:
            skipped.append({"path": rel, "reason": "path_outside_upload_dir"})
            continue
        if not target.exists():
            skipped.append({"path": rel, "reason": "not_found"})
            continue
        if rel in refs:
            skipped.append({"path": rel, "reason": "now_referenced"})
            continue
        try:
            target.unlink()
            deleted.append(rel)
        except OSError as e:
            skipped.append({"path": rel, "reason": f"unlink_failed: {e}"})
    if deleted:
        await audit_log(
            db, user_id=admin.id, entity="orphan_files", entity_id=0,
            action=AuditAction.DELETE,
            before={"count": len(deleted), "paths": deleted[:50]},
        )
        await db.commit()
    return {
        "deleted_count": len(deleted),
        "deleted": deleted,
        "skipped_count": len(skipped),
        "skipped": skipped,
    }
