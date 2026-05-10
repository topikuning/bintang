/**
 * Tipe API Bintang -- mirror dari backend Pydantic schemas.
 *
 * Ini ditulis tangan dulu (subset yang kita butuh utk Phase 0-1).
 * Phase berikutnya pertimbangkan generate otomatis via openapi-typescript
 * dari /openapi.json.
 */

export type UserRole =
  | "SUPERADMIN"      // god-mode: hard delete + edit transaksi VERIFIED
  | "CENTRAL_ADMIN"   // admin pusat, manage semua kecuali ops destruktif/VERIFIED
  | "PROJECT_ADMIN"   // admin proyek, scoped ke project_users
  | "EXECUTIVE"       // view-only (laporan, dashboard)

export interface User {
  id: number
  email: string
  name: string
  role: UserRole
  scope_all_projects: boolean
  is_active: boolean
  phone?: string | null
  /** Project IDs yg boleh diakses; [] berarti akses semua (kalau scope_all_projects=true). */
  project_ids?: number[]
}

/** Backend /auth/login (OAuth2 password flow) hanya return token. */
export interface TokenResponse {
  access_token: string
  token_type: "bearer"
}

export interface Project {
  id: number
  code: string
  name: string
  company_id: number
  budget_amount: string | number
  is_active: boolean
}

export interface Page<T> {
  items: T[]
  total: number
  page: number
  size: number
}

export interface Attachment {
  id: number
  file_name: string
  file_size: number
  mime_type: string
  /** Relative path (mis. "transactions/123/foo.pdf") atau URL absolut external (https://...). */
  url: string
  created_at: string
}

export type TxnType = "IN" | "OUT"
export type TxnStatus =
  | "DRAFT"
  | "SUBMITTED"
  | "VERIFIED"
  | "REJECTED"
  | "CANCELLED"
export type PaymentMethod = "TRANSFER" | "CASH" | "QRIS" | "OTHER"

export interface Transaction {
  id: number
  project_id: number
  tx_date: string
  type: TxnType
  category_id: number | null
  amount: string
  party_name: string | null
  vendor_client_id: number | null
  payment_method: PaymentMethod
  reference_no: string | null
  description: string | null
  status: TxnStatus
  invoice_id: number | null
  purchase_order_id: number | null
  created_by_id: number
  verified_by_id: number | null
  verified_at: string | null
  cancel_reason?: string | null
  created_at: string
  updated_at: string
  attachments?: Attachment[]
}

export type InvoiceType = "IN" | "OUT"
export type InvoiceStatus =
  | "DRAFT"
  | "ISSUED"
  | "PARTIALLY_PAID"
  | "PAID"
  | "OVERDUE"
  | "CANCELLED"

export interface Invoice {
  id: number
  number: string
  project_id: number
  type: InvoiceType
  invoice_date: string
  due_date: string | null
  party_name: string | null
  vendor_client_id: number | null
  subtotal: string
  tax: string
  total: string
  status: InvoiceStatus
  paid_amount?: string
  outstanding_amount?: string
  remaining?: string
  created_at: string
  updated_at: string
}

export type POStatus = "DRAFT" | "ISSUED" | "APPROVED" | "CANCELLED"

export interface PurchaseOrder {
  id: number
  number: string
  project_id: number
  company_id: number
  vendor_client_id: number | null
  vendor_name: string | null
  po_date: string
  total: string
  status: POStatus
  created_at: string
  updated_at: string
}
