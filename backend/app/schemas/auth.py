from pydantic import BaseModel, EmailStr

from app.models.models import UserRole


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"


class UserOut(BaseModel):
    id: int
    email: EmailStr
    name: str
    role: UserRole
    is_active: bool
    phone: str | None = None
    scope_all_projects: bool = False
    telegram_chat_id: str | None = None
    whatsapp_chat_id: str | None = None

    class Config:
        from_attributes = True


class UserMe(UserOut):
    project_ids: list[int] = []


class UserCreate(BaseModel):
    email: EmailStr
    password: str
    name: str
    role: UserRole = UserRole.PROJECT_ADMIN
    phone: str | None = None
    scope_all_projects: bool = False


class UserUpdate(BaseModel):
    name: str | None = None
    role: UserRole | None = None
    is_active: bool | None = None
    phone: str | None = None
    password: str | None = None
    scope_all_projects: bool | None = None
    # Force-link contact (SUPERADMIN only). Set ke null/string-kosong utk
    # unlink. telegram_chat_id: numeric/string apa adanya.
    telegram_chat_id: str | None = None
    # whatsapp_phone: input user-friendly (628xxxx), server convert ke
    # whatsapp_chat_id (<msisdn>@c.us). Kalau diisi, overwrite chat_id.
    whatsapp_phone: str | None = None
    # whatsapp_chat_id: direct input formal (<msisdn>@c.us). Override
    # whatsapp_phone kalau keduanya diisi.
    whatsapp_chat_id: str | None = None
