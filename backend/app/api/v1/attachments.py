from fastapi import APIRouter, Depends

from app.core.deps import get_current_user
from app.models.models import User

router = APIRouter()


@router.get("/health")
async def attachments_health(_user: User = Depends(get_current_user)) -> dict:
    """Reserved for direct attachment listing/streaming. Files are served via /files/*."""
    return {"status": "ok"}
