"""Async OCRJob lifecycle test (T3.8).

Pipeline test sudah cover extraction logic; di sini fokus state machine.
"""
from __future__ import annotations

from datetime import datetime, timezone

import pytest

from app.core.security import create_access_token, hash_password
from app.models.models import OCRJob, OCRJobStatus, User, UserRole


async def _user(db, email="j@x"):
    u = User(email=email, name="J", password_hash=hash_password("x"),
             role=UserRole.PROJECT_ADMIN)
    db.add(u); await db.flush()
    return u


@pytest.mark.asyncio
async def test_ocr_job_model_lifecycle(db):
    """Create PENDING -> PROCESSING -> DONE row di-store dgn benar."""
    u = await _user(db)
    job = OCRJob(
        user_id=u.id, entity="invoice",
        source_url="/files/ocr/x.jpg", file_size_bytes=100,
        status=OCRJobStatus.PENDING,
    )
    db.add(job); await db.flush()
    assert job.status == OCRJobStatus.PENDING

    job.status = OCRJobStatus.PROCESSING
    job.started_at = datetime.now(timezone.utc)
    await db.flush()
    assert job.status == OCRJobStatus.PROCESSING
    assert job.started_at is not None

    job.status = OCRJobStatus.DONE
    job.completed_at = datetime.now(timezone.utc)
    job.result = {"total": "1000", "vendor_name": "X"}
    await db.commit()
    await db.refresh(job)
    assert job.status == OCRJobStatus.DONE
    assert job.result["total"] == "1000"


@pytest.mark.asyncio
async def test_ocr_job_failed_with_error(db):
    u = await _user(db, email="k@x")
    job = OCRJob(
        user_id=u.id, source_url="/files/x.jpg", file_size_bytes=50,
        status=OCRJobStatus.PENDING,
    )
    db.add(job); await db.flush()
    job.status = OCRJobStatus.FAILED
    job.error = "anthropic_timeout_60s"
    job.completed_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(job)
    assert job.status == OCRJobStatus.FAILED
    assert "timeout" in job.error
