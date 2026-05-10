/**
 * Tipe API Bintang -- mirror dari backend Pydantic schemas.
 *
 * Ini ditulis tangan dulu (subset yang kita butuh utk Phase 0-1).
 * Phase berikutnya pertimbangkan generate otomatis via openapi-typescript
 * dari /openapi.json.
 */

export type UserRole =
  | "SUPERADMIN"
  | "CENTRAL_ADMIN"
  | "PROJECT_ADMIN"
  | "PROJECT_USER"
  | "VIEWER"

export interface User {
  id: number
  email: string
  name: string
  role: UserRole
  scope_all_projects: boolean
  is_active: boolean
}

export interface LoginResponse {
  access_token: string
  token_type: "bearer"
  user: User
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
  created_at: string
  updated_at: string
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
