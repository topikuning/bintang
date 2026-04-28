export type Role = "SUPERADMIN" | "CENTRAL_ADMIN" | "PROJECT_ADMIN" | "EXECUTIVE";
export type TxnType = "IN" | "OUT";
export type TxnStatus = "DRAFT" | "SUBMITTED" | "VERIFIED" | "REJECTED" | "CANCELLED";
export type PaymentMethod = "CASH" | "TRANSFER" | "QRIS" | "GIRO" | "OTHER";
export type PartyType = "COMPANY" | "PERSONAL" | "EMPLOYEE" | "INTERNAL" | "OTHER";
export type InvoiceType = "IN" | "OUT";
export type InvoiceStatus =
  | "DRAFT"
  | "ISSUED"
  | "PARTIALLY_PAID"
  | "PAID"
  | "OVERDUE"
  | "CANCELLED";
export type POStatus =
  | "DRAFT"
  | "ISSUED"
  | "APPROVED"
  | "PARTIALLY_FULFILLED"
  | "FULFILLED"
  | "CANCELLED";
export type ProjectStatus = "AKTIF" | "SELESAI" | "DITAHAN" | "DIBATALKAN";
export type CategoryType = "IN" | "OUT";

export interface User {
  id: number;
  email: string;
  name: string;
  role: Role;
  is_active: boolean;
  phone?: string | null;
  scope_all_projects?: boolean;
  project_ids?: number[];
}

export interface Company {
  id: number;
  name: string;
  address?: string | null;
  npwp?: string | null;
  phone?: string | null;
  email?: string | null;
  logo_url?: string | null;
  letterhead_url?: string | null;
  director_name?: string | null;
  bank_account?: string | null;
}

export interface Project {
  id: number;
  code: string;
  name: string;
  location?: string | null;
  company_id: number;
  pic_user_id?: number | null;
  start_date?: string | null;
  end_date?: string | null;
  status: ProjectStatus;
  notes?: string | null;
  project_value: string;
  budget_amount: string;
  currency: string;
  overbudget_tolerance_pct: string;
  tax_ppn_pct: string;
  tax_pph_pct: string;
  marketing_pct: string;
}

export interface Category {
  id: number;
  name: string;
  type: CategoryType;
  description?: string | null;
}

export interface VendorClient {
  id: number;
  name: string;
  type: "VENDOR" | "CLIENT" | "BOTH";
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  npwp?: string | null;
  bank_account?: string | null;
  contact?: string | null;
}

export interface Attachment {
  id: number;
  file_name: string;
  file_size: number;
  mime_type: string;
  url: string;
  created_at: string;
}

export interface Transaction {
  id: number;
  project_id: number;
  tx_date: string;
  type: TxnType;
  category_id?: number | null;
  amount: string;
  party_type?: PartyType | null;
  party_name?: string | null;
  party_id_number?: string | null;
  party_account?: string | null;
  vendor_client_id?: number | null;
  payment_method: PaymentMethod;
  reference_no?: string | null;
  description?: string | null;
  usage_note?: string | null;
  invoice_id?: number | null;
  purchase_order_id?: number | null;
  status: TxnStatus;
  cancel_reason?: string | null;
  created_by_id: number;
  verified_by_id?: number | null;
  verified_at?: string | null;
  created_at: string;
  attachments: Attachment[];
}

export interface InvoiceItem {
  id: number;
  description: string;
  quantity: string;
  unit?: string | null;
  unit_price: string;
  subtotal: string;
}

export interface InvoicePayment {
  id: number;
  tx_date: string;
  type: TxnType;
  amount: string;
  status: TxnStatus;
  payment_method: PaymentMethod;
  reference_no?: string | null;
  description?: string | null;
  created_at: string;
}

export interface Invoice {
  id: number;
  number: string;
  project_id: number;
  type: InvoiceType;
  invoice_date: string;
  due_date?: string | null;
  vendor_client_id?: number | null;
  party_name?: string | null;
  subtotal: string;
  tax: string;
  total: string;
  status: InvoiceStatus;
  notes?: string | null;
  created_by_id: number;
  created_at: string;
  paid_amount: string;
  remaining: string;
  attachments: Attachment[];
  items: InvoiceItem[];
  payments: InvoicePayment[];
}

export interface POItem {
  id: number;
  description: string;
  quantity: string;
  unit?: string | null;
  unit_price: string;
  subtotal: string;
}

export interface PurchaseOrder {
  id: number;
  number: string;
  project_id: number;
  company_id: number;
  vendor_client_id?: number | null;
  vendor_name?: string | null;
  po_date: string;
  needed_date?: string | null;
  subtotal: string;
  tax: string;
  discount: string;
  total: string;
  payment_terms?: string | null;
  notes?: string | null;
  status: POStatus;
  cancel_reason?: string | null;
  created_by_id: number;
  approved_by_id?: number | null;
  approved_at?: string | null;
  created_at: string;
  items: POItem[];
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  size: number;
}
