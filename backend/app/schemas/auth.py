import re

from pydantic import BaseModel, EmailStr, field_validator

from app.models.models import UserRole


# Username format: 3-50 char, lowercase alphanumeric + dot/underscore/dash.
# Sengaja tdk allow '@' supaya jelas dibedakan dari email saat login lookup.
USERNAME_RE = re.compile(r"^[a-z0-9._-]{3,50}$")


def normalize_username(value: str | None) -> str | None:
    """Trim + lowercase. None / empty -> None (artinya unset)."""
    if value is None:
        return None
    v = value.strip().lower()
    return v or None


def validate_username(value: str | None) -> str | None:
    """Normalize + validate format. Return normalized atau raise ValueError."""
    v = normalize_username(value)
    if v is None:
        return None
    if not USERNAME_RE.match(v):
        raise ValueError(
            "username_invalid_format: 3-50 char, hanya huruf kecil/angka/titik/garis-bawah/strip"
        )
    return v


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"


class UserOut(BaseModel):
    id: int
    email: EmailStr
    username: str | None = None
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
    username: str | None = None
    password: str
    name: str
    role: UserRole = UserRole.PROJECT_ADMIN
    phone: str | None = None
    scope_all_projects: bool = False

    @field_validator("username")
    @classmethod
    def _check_username(cls, v: str | None) -> str | None:
        return validate_username(v)


class UserUpdate(BaseModel):
    name: str | None = None
    username: str | None = None
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

    @field_validator("username")
    @classmethod
    def _check_username(cls, v: str | None) -> str | None:
        # None artinya field tidak di-set di payload (exclude_unset di
        # endpoint handle that). Empty string artinya eksplisit clear.
        if v == "":
            return None
        return validate_username(v)
