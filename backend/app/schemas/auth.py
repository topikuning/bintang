from pydantic import BaseModel, EmailStr

from app.models.models import UserRole


class LoginIn(BaseModel):
    email: EmailStr
    password: str


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


class UserUpdate(BaseModel):
    name: str | None = None
    role: UserRole | None = None
    is_active: bool | None = None
    phone: str | None = None
    password: str | None = None
