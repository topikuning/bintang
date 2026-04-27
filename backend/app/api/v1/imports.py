from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user, require_superadmin
from app.db.session import get_db
from app.models.models import User
from app.services.excel.importer import SCHEMAS, build_template, read_xlsx

router = APIRouter()


@router.get("/")
async def list_entities(_user: User = Depends(get_current_user)) -> list[dict]:
    return [
        {
            "key": k,
            "label": v["label"],
            "headers": v["headers"],
            "note": v.get("note"),
        }
        for k, v in SCHEMAS.items()
    ]


@router.get("/{entity}/template")
async def download_template(
    entity: str,
    _user: User = Depends(get_current_user),
) -> Response:
    if entity not in SCHEMAS:
        raise HTTPException(404, "unknown_entity")
    s = SCHEMAS[entity]
    data = build_template(s["headers"], s.get("example"))
    return Response(
        content=data,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="template-{entity}.xlsx"'},
    )


async def _process(
    entity: str,
    file: UploadFile,
    db: AsyncSession,
    user: User,
    commit: bool,
) -> dict:
    if entity not in SCHEMAS:
        raise HTTPException(404, "unknown_entity")
    if not file.filename or not file.filename.lower().endswith((".xlsx", ".xlsm")):
        raise HTTPException(415, "Hanya file .xlsx yang diterima")
    content = await file.read()
    if len(content) > 20 * 1024 * 1024:
        raise HTTPException(413, "File terlalu besar (>20MB)")
    try:
        rows = read_xlsx(content)
    except Exception as e:
        raise HTTPException(400, f"Tidak bisa membaca file: {e}") from e
    if not rows:
        raise HTTPException(400, "File kosong atau tidak ada baris data")

    handler = SCHEMAS[entity]["handler"]
    try:
        valid, errors = await handler(rows, db, user, commit)
        if commit:
            await db.commit()
    except Exception as e:
        await db.rollback()
        raise HTTPException(500, f"Gagal mengimpor: {e}") from e

    return {
        "entity": entity,
        "total_rows": len(rows),
        "valid_count": len(valid),
        "error_count": len(errors),
        "committed": commit,
        "samples": valid[:20],
        "errors": errors[:50],
    }


@router.post("/{entity}/preview")
async def preview(
    entity: str,
    file: Annotated[UploadFile, File(...)],
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_superadmin),
) -> dict:
    return await _process(entity, file, db, user, commit=False)


@router.post("/{entity}/commit")
async def commit_import(
    entity: str,
    file: Annotated[UploadFile, File(...)],
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_superadmin),
) -> dict:
    return await _process(entity, file, db, user, commit=True)
