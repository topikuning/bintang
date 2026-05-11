from datetime import date
from decimal import Decimal

from pydantic import BaseModel

from app.models.models import (
    CategoryType,
    ProjectStatus,
    VendorClientType,
)


# Companies
class CompanyBase(BaseModel):
    name: str
    address: str | None = None
    npwp: str | None = None
    phone: str | None = None
    email: str | None = None
    logo_url: str | None = None
    letterhead_url: str | None = None
    director_name: str | None = None
    bank_account: str | None = None


class CompanyCreate(CompanyBase):
    pass


class CompanyUpdate(BaseModel):
    name: str | None = None
    address: str | None = None
    npwp: str | None = None
    phone: str | None = None
    email: str | None = None
    logo_url: str | None = None
    letterhead_url: str | None = None
    director_name: str | None = None
    bank_account: str | None = None


class CompanyOut(CompanyBase):
    id: int

    class Config:
        from_attributes = True


# Projects
class ProjectBase(BaseModel):
    code: str
    name: str
    location: str | None = None
    company_id: int
    client_name: str | None = None
    pic_user_id: int | None = None
    start_date: date | None = None
    end_date: date | None = None
    status: ProjectStatus = ProjectStatus.AKTIF
    notes: str | None = None
    project_value: Decimal = Decimal("0")
    budget_amount: Decimal = Decimal("0")
    currency: str = "IDR"
    overbudget_tolerance_pct: Decimal = Decimal("0")
    tax_ppn_pct: Decimal = Decimal("11")
    tax_pph_pct: Decimal = Decimal("2")
    marketing_pct: Decimal = Decimal("15")


class ProjectCreate(ProjectBase):
    pass


class ProjectUpdate(BaseModel):
    code: str | None = None
    name: str | None = None
    location: str | None = None
    company_id: int | None = None
    client_name: str | None = None
    pic_user_id: int | None = None
    start_date: date | None = None
    end_date: date | None = None
    status: ProjectStatus | None = None
    notes: str | None = None
    project_value: Decimal | None = None
    budget_amount: Decimal | None = None
    currency: str | None = None
    overbudget_tolerance_pct: Decimal | None = None
    tax_ppn_pct: Decimal | None = None
    tax_pph_pct: Decimal | None = None
    marketing_pct: Decimal | None = None


class ProjectOut(ProjectBase):
    id: int
    # Diisi dari relasi Project.company (selectinload di endpoint).
    # Membantu UI menampilkan dan mencari proyek berdasarkan perusahaan.
    company_name: str | None = None
    # Proposal workflow metadata (None utk proyek lama / yg langsung dibuat admin).
    proposed_by_id: int | None = None
    proposed_by_name: str | None = None
    approved_by_id: int | None = None
    approved_by_name: str | None = None
    approved_at: str | None = None
    rejection_reason: str | None = None

    class Config:
        from_attributes = True


class ProjectProposalCreate(BaseModel):
    """Subset payload utk endpoint POST /projects/proposal.

    Kolom yg perlu admin atur (tax/marketing/budget detail) di-set default --
    admin bisa edit setelah approve. Pengaju cukup isi info inti.
    """
    code: str
    name: str
    location: str | None = None
    company_id: int
    client_name: str | None = None
    start_date: date | None = None
    end_date: date | None = None
    notes: str | None = None
    project_value: Decimal = Decimal("0")
    budget_amount: Decimal = Decimal("0")


class ProjectRejectIn(BaseModel):
    reason: str


# Categories
class CategoryBase(BaseModel):
    name: str
    type: CategoryType
    description: str | None = None


class CategoryCreate(CategoryBase):
    pass


class CategoryUpdate(BaseModel):
    name: str | None = None
    type: CategoryType | None = None
    description: str | None = None


class CategoryOut(CategoryBase):
    id: int

    class Config:
        from_attributes = True


# Vendors / Clients
class VendorClientBase(BaseModel):
    name: str
    type: VendorClientType = VendorClientType.VENDOR
    address: str | None = None
    npwp: str | None = None
    contact: str | None = None
    phone: str | None = None
    email: str | None = None
    bank_account: str | None = None


class VendorClientCreate(VendorClientBase):
    pass


class VendorClientUpdate(BaseModel):
    name: str | None = None
    type: VendorClientType | None = None
    address: str | None = None
    npwp: str | None = None
    contact: str | None = None
    phone: str | None = None
    email: str | None = None
    bank_account: str | None = None


class VendorClientOut(VendorClientBase):
    id: int

    class Config:
        from_attributes = True
