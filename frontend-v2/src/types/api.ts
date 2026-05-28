/**
 * Tipe API CACAK -- mirror dari backend Pydantic schemas.
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
  /** Username opsional utk login alternatif (selain email). Lowercase. */
  username?: string | null
  name: string
  role: UserRole
  scope_all_projects: boolean
  is_active: boolean
  phone?: string | null
  /** Telegram chat_id (force-link by SUPERADMIN) */
  telegram_chat_id?: string | null
  /** WhatsApp chat_id WAHA format (msisdn@c.us) */
  whatsapp_chat_id?: string | null
  /** Project IDs yg boleh diakses; [] berarti akses semua (kalau scope_all_projects=true). */
  project_ids?: number[]
}

/** Backend /auth/login (OAuth2 password flow) hanya return token. */
export interface TokenResponse {
  access_token: string
  token_type: "bearer"
}

export type ProjectStatus =
  | "MENUNGGU_PERSETUJUAN"
  | "AKTIF"
  | "SELESAI"
  | "DITAHAN"
  | "DIBATALKAN"

export type ProjectKind = "REGULAR" | "NON_PROJECT"

export interface Project {
  id: number
  code: string
  name: string
  location: string | null
  company_id: number
  company_name?: string | null
  client_name: string | null
  pic_user_id: number | null
  start_date: string | null
  end_date: string | null
  status: ProjectStatus
  /** Timestamp perubahan field apapun -- FE pakai sbg proxy "sejak kapan
   *  status ini" di banner ProjectStatusBanner. Audit 2026-05-24. */
  updated_at?: string
  /** Klasifikasi proyek (REGULAR / NON_PROJECT). System project
   *  Catatan Non-Proyek = NON_PROJECT (1 per company). */
  kind: ProjectKind
  notes: string | null
  project_value: string | number
  budget_amount: string | number
  currency: string
  overbudget_tolerance_pct: string | number
  tax_ppn_pct: string | number
  tax_pph_pct: string | number
  marketing_pct: string | number
  // Proposal workflow metadata
  proposed_by_id?: number | null
  proposed_by_name?: string | null
  approved_by_id?: number | null
  approved_by_name?: string | null
  approved_at?: string | null
  rejection_reason?: string | null
  // Pendana = User(role=EXECUTIVE) ter-link via project_users.
  // Field name `funder_*` dipertahankan utk backward-compat & semantic
  // domain (lihat migration 20260518_1400). Value = user.id, name = user.full_name.
  funder_ids?: number[]
  funder_names?: string[]
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
export type TxnKind = "INVOICE_PAYMENT" | "CASH_ADVANCE" | "DIRECT_EXPENSE"
export type TxnStatus =
  | "DRAFT"
  | "SUBMITTED"
  | "VERIFIED"
  | "REJECTED"
  | "CANCELLED"
export type PaymentMethod = "TRANSFER" | "CASH" | "QRIS" | "OTHER"

export interface TransactionItem {
  id: number
  category_id: number | null
  description: string
  amount: string | number
}

export interface Transaction {
  id: number
  project_id: number
  tx_date: string
  type: TxnType
  kind: TxnKind
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
  recipient_user_id: number | null
  recipient_name: string | null
  recipient_display?: string | null
  settlement_status?: "OUTSTANDING" | "SETTLED" | null
  settlement_id?: number | null
  parent_advance_tx_id?: number | null
  items?: TransactionItem[]
  /** Alokasi tx ini ke invoice (M:N via InvoiceAllocation). Diisi backend
   *  utk tampilkan bidirectional link (tx -> invoice yg dibayar). */
  allocations?: TransactionAllocationRef[]
  /** Total amount yg sudah ter-alokasi ke invoice. */
  allocated_amount?: string
  remaining_amount?: string
  created_by_id: number
  verified_by_id: number | null
  verified_at: string | null
  cancel_reason?: string | null
  created_at: string
  updated_at: string
  attachments?: Attachment[]
}

export interface CashAdvanceSettlementItem {
  id: number
  category_id: number | null
  description: string
  amount: string | number
  receipt_url?: string | null
  /** Kalau item ini bayar invoice eksternal */
  invoice_id?: number | null
  invoice_number?: string | null
}

export interface CashAdvanceSettlement {
  id: number
  cash_advance_tx_id: number
  settled_at: string
  settled_by_id: number
  settled_by_name?: string | null
  returned_to_kas: string | number
  topup_tx_id: number | null
  topup_amount?: string | number | null
  notes?: string | null
  items: CashAdvanceSettlementItem[]
}

export interface CashAdvanceBalanceRow {
  recipient_user_id: number | null
  recipient_name: string
  advance_total: string | number
  settled_total: string | number
  outstanding: string | number
  advance_count: number
  unsettled_count: number
}

export interface CashAdvanceOutstandingRow {
  id: number
  tx_date: string
  project_id: number
  amount: string
  recipient_user_id: number | null
  recipient_name: string | null
  recipient_display: string
  description: string | null
  status: TxnStatus
  created_by_id: number
  age_days: number
}

export type InvoiceType = "IN" | "OUT"
export type InvoiceStatus =
  | "DRAFT"
  | "ISSUED"
  | "PARTIALLY_PAID"
  | "PAID"
  | "OVERDUE"
  | "CANCELLED"

export interface InvoiceItem {
  id: number
  description: string
  quantity: string
  unit: string | null
  unit_price: string
  subtotal: string
  /** Audit 2026-05-24: per-item kategori. */
  category_id: number | null
}

export interface InvoiceItemInput {
  description: string
  quantity: number | string
  unit?: string | null
  unit_price: number | string
  category_id?: number | null
}

export interface InvoicePayment {
  id: number              // transaction_id
  allocation_id: number
  tx_date: string
  type: TxnType
  amount: string          // nilai yg dialokasikan ke invoice ini
  transaction_total: string
  status: TxnStatus
  payment_method: PaymentMethod
  reference_no: string | null
  description: string | null
  created_at: string
}

export interface Invoice {
  id: number
  number: string
  project_id: number
  type: InvoiceType
  invoice_date: string
  due_date: string | null
  party_name: string | null
  vendor_client_id: number | null
  tax: string
  notes?: string | null
  subtotal: string
  total: string
  status: InvoiceStatus
  paid_amount?: string
  outstanding_amount?: string
  remaining?: string
  created_by_id?: number
  created_at: string
  updated_at?: string
  attachments?: Attachment[]
  items?: InvoiceItem[]
  payments?: InvoicePayment[]
}

// Allocation (sambungan transaksi pembayaran <-> invoice)
export interface AllocatableTransactionRow {
  id: number
  tx_date: string
  type: TxnType
  party_name: string | null
  payment_method: PaymentMethod
  reference_no: string | null
  description: string | null
  status: TxnStatus
  total_amount: string
  allocated_amount: string
  remaining_amount: string
}

export interface AllocatableInvoiceRow {
  id: number
  number: string
  invoice_date: string
  due_date: string | null
  type: InvoiceType
  party_name: string | null
  status: InvoiceStatus
  total_amount: string
  paid_amount: string
  outstanding_amount: string
}

export interface AllocationOut {
  id: number
  transaction_id: number
  invoice_id: number
  allocated_amount: string
  note: string | null
  created_at: string
}

/** Mirror backend TransactionAllocationRef -- info ringkas invoice yg
 *  dibayar oleh suatu tx, dipakai utk render bidirectional link. */
export interface TransactionAllocationRef {
  id: number  // allocation_id
  invoice_id: number
  invoice_number: string | null
  invoice_total: string
  invoice_status: InvoiceStatus
  allocated_amount: string
}

export interface AllocationApplyResult {
  applied: AllocationOut[]
  total_applied: string
  leftover_requested: string
  invoice_paid: string
  invoice_outstanding: string
  invoice_status: InvoiceStatus
}

export type POStatus = "DRAFT" | "ISSUED" | "APPROVED" | "CANCELLED"

export interface POItem {
  id: number
  description: string
  quantity: string
  unit: string | null
  unit_price: string
  subtotal: string
}

export interface POItemInput {
  description: string
  quantity: number | string
  unit?: string | null
  unit_price: number | string
}

export interface PurchaseOrder {
  id: number
  number: string
  project_id: number
  company_id: number
  vendor_client_id: number | null
  vendor_name: string | null
  /** Resolved nama vendor dari master VendorClient (kalau
   *  vendor_client_id di-set). Backend prefill -- FE pakai dgn
   *  fallback ke vendor_name. */
  vendor_client_name?: string | null
  po_date: string
  needed_date?: string | null
  payment_terms?: string | null
  notes?: string | null
  tax: string
  discount: string
  subtotal: string
  total: string
  status: POStatus
  created_by_id?: number
  approved_by_id?: number | null
  approved_at?: string | null
  cancel_reason?: string | null
  created_at: string
  updated_at?: string
  items?: POItem[]
}

// Master data shapes (untuk CRUD page)
export interface Company {
  id: number
  name: string
  address?: string | null
  npwp?: string | null
  phone?: string | null
  email?: string | null
  logo_url?: string | null
  letterhead_url?: string | null
  director_name?: string | null
  bank_account?: string | null
}

export interface CompanyInput {
  name: string
  address?: string | null
  npwp?: string | null
  phone?: string | null
  email?: string | null
  logo_url?: string | null
  letterhead_url?: string | null
  director_name?: string | null
  bank_account?: string | null
}

export type CategoryType = "IN" | "OUT" | "BOTH"

export interface CategoryInput {
  name: string
  type: CategoryType
  description?: string | null
  is_marketing?: boolean
  is_penalty?: boolean
  is_profit_share?: boolean
}

export type VendorClientType = "VENDOR" | "CLIENT" | "BOTH"

export interface VendorClientInput {
  name: string
  type: VendorClientType
  address?: string | null
  npwp?: string | null
  contact?: string | null
  phone?: string | null
  email?: string | null
  bank_account?: string | null
}

// Audit log
export type AuditAction =
  | "CREATE"
  | "UPDATE"
  | "DELETE"
  | "SUBMIT"
  | "VERIFY"
  | "REJECT"
  | "CANCEL"
  | "APPROVE"

export interface AuditLogEntry {
  id: number
  created_at: string
  user_id: number
  user_name: string | null
  entity: string
  entity_id: number
  action: AuditAction | string
  before: Record<string, unknown> | null
  after: Record<string, unknown> | null
  note: string | null
}

// User mutation types
export interface UserCreateInput {
  email: string
  /** Opsional, 3-50 char [a-z0-9._-]. Backend force lowercase. */
  username?: string | null
  password: string
  name: string
  role: UserRole
  phone?: string | null
  scope_all_projects?: boolean
}

export interface UserUpdateInput {
  name?: string
  /** SUPERADMIN-only. Empty string = clear; omit = no change. */
  username?: string | null
  role?: UserRole
  is_active?: boolean
  phone?: string | null
  password?: string | null
  scope_all_projects?: boolean
  /** Force-link by SUPERADMIN. Empty = unlink. */
  telegram_chat_id?: string | null
  /** Nomor WA biasa (628xxxx atau 08xxxx). Server convert ke <msisdn>@c.us. */
  whatsapp_phone?: string | null
  /** Direct WAHA format (override whatsapp_phone). */
  whatsapp_chat_id?: string | null
}


// ===== Cash Requests (Pengajuan Dana) =====
export type CashRequestStatus =
  | "PENDING"
  | "APPROVED"
  | "REJECTED"
  | "CANCELLED"
  /** Disbursement tx CASH_ADVANCE-nya di-cancel setelah CR approved.
   *  Final state -- CR tidak kembali ke PENDING. */
  | "DISBURSEMENT_CANCELLED"

export interface CashRequestItem {
  id: number
  category_id: number | null
  category_name: string | null
  description: string
  quantity: string | null
  unit_price: string | null
  amount: string
}

export interface CashRequestItemInput {
  category_id?: number | null
  description: string
  quantity?: string | number | null
  unit_price?: string | number | null
  amount: string | number
}

export interface CashRequest {
  id: number
  number: string
  project_id: number
  project_code: string | null
  project_name: string | null
  requester_id: number
  requester_name: string | null
  recipient_user_id: number | null
  recipient_name: string | null
  request_date: string
  title: string
  notes: string | null
  total_amount: string
  status: CashRequestStatus
  approved_by_id: number | null
  approved_by_name: string | null
  approved_at: string | null
  rejected_by_id: number | null
  rejected_by_name: string | null
  rejected_at: string | null
  rejection_reason: string | null
  disbursement_tx_id: number | null
  items: CashRequestItem[]
  created_at: string
  updated_at: string
}

export interface CashRequestCreateInput {
  project_id: number
  recipient_user_id?: number | null
  request_date: string
  title: string
  notes?: string | null
  items: CashRequestItemInput[]
}

export interface CashRequestUpdateInput {
  project_id?: number
  recipient_user_id?: number | null
  request_date?: string
  title?: string
  notes?: string | null
  items?: CashRequestItemInput[]
}
