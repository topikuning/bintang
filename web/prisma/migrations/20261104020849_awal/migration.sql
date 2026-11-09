-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('super_admin', 'director', 'finance', 'project_admin', 'staff', 'viewer');

-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('aktif', 'ditahan', 'selesai', 'batal');

-- CreateEnum
CREATE TYPE "ProjectKind" AS ENUM ('proyek', 'operasional');

-- CreateEnum
CREATE TYPE "CashDirection" AS ENUM ('masuk', 'keluar');

-- CreateEnum
CREATE TYPE "AccountKind" AS ENUM ('kas', 'bank');

-- CreateEnum
CREATE TYPE "PartyKind" AS ENUM ('vendor', 'klien', 'karyawan', 'lainnya');

-- CreateEnum
CREATE TYPE "RequestKind" AS ENUM ('pembayaran', 'uang_muka', 'penggantian');

-- CreateEnum
CREATE TYPE "RequestStatus" AS ENUM ('draft', 'diajukan', 'perlu_revisi', 'disetujui', 'dibayar', 'lpj_diajukan', 'selesai', 'ditolak', 'dibatalkan');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('transfer', 'tunai', 'qris', 'giro', 'lainnya');

-- CreateEnum
CREATE TYPE "TransactionKind" AS ENUM ('pemasukan', 'pengeluaran', 'uang_muka', 'pengembalian_uang_muka', 'realisasi_uang_muka');

-- CreateEnum
CREATE TYPE "TransactionStatus" AS ENUM ('menunggu_verifikasi', 'terverifikasi', 'ditolak', 'dibatalkan');

-- CreateEnum
CREATE TYPE "AttachmentKind" AS ENUM ('nota', 'bukti_bayar', 'lpj', 'lainnya');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "full_name" TEXT NOT NULL,
    "username" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "password_hash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "must_change_password" BOOLEAN NOT NULL DEFAULT false,
    "token_version" INTEGER NOT NULL DEFAULT 0,
    "all_projects" BOOLEAN NOT NULL DEFAULT false,
    "bank_name" TEXT,
    "bank_account" TEXT,
    "bank_holder" TEXT,
    "last_login_at" TIMESTAMPTZ,
    "legacy_id" INTEGER,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "token_version" INTEGER NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "revoked_at" TIMESTAMPTZ,
    "ip" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "login_attempts" (
    "id" UUID NOT NULL,
    "identifier" TEXT NOT NULL,
    "ip" TEXT NOT NULL,
    "success" BOOLEAN NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "login_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "companies" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "city" TEXT,
    "npwp" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "legacy_id" INTEGER,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projects" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "ProjectKind" NOT NULL DEFAULT 'proyek',
    "company_id" UUID NOT NULL,
    "client" TEXT,
    "location" TEXT,
    "contract_value" BIGINT NOT NULL DEFAULT 0,
    "budget" BIGINT NOT NULL DEFAULT 0,
    "start_date" DATE,
    "end_date" DATE,
    "status" "ProjectStatus" NOT NULL DEFAULT 'aktif',
    "notes" TEXT,
    "legacy_id" INTEGER,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_members" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categories" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "direction" "CashDirection" NOT NULL,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "legacy_id" INTEGER,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "parties" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "PartyKind" NOT NULL DEFAULT 'vendor',
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "npwp" TEXT,
    "bank_name" TEXT,
    "bank_account" TEXT,
    "bank_holder" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "legacy_id" INTEGER,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "parties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounts" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "AccountKind" NOT NULL DEFAULT 'bank',
    "company_id" UUID,
    "bank_name" TEXT,
    "account_number" TEXT,
    "opening_balance" BIGINT NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_requests" (
    "id" UUID NOT NULL,
    "number" TEXT,
    "project_id" UUID NOT NULL,
    "kind" "RequestKind" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "urgent" BOOLEAN NOT NULL DEFAULT false,
    "needed_date" DATE,
    "total" BIGINT NOT NULL DEFAULT 0,
    "status" "RequestStatus" NOT NULL DEFAULT 'draft',
    "party_id" UUID,
    "payee_name" TEXT,
    "bank_name" TEXT,
    "bank_account" TEXT,
    "bank_holder" TEXT,
    "requester_id" UUID NOT NULL,
    "submitted_at" TIMESTAMPTZ,
    "approver_id" UUID,
    "approved_at" TIMESTAMPTZ,
    "approval_note" TEXT,
    "payer_id" UUID,
    "paid_at" TIMESTAMPTZ,
    "paid_date" DATE,
    "account_id" UUID,
    "payment_method" "PaymentMethod",
    "payment_ref" TEXT,
    "lpj_submitted_at" TIMESTAMPTZ,
    "lpj_note" TEXT,
    "closed_at" TIMESTAMPTZ,
    "legacy_id" INTEGER,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "payment_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_request_items" (
    "id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "category_id" UUID,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(15,3),
    "unit" TEXT,
    "unit_price" BIGINT,
    "amount" BIGINT NOT NULL,

    CONSTRAINT "payment_request_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_request_realizations" (
    "id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "category_id" UUID,
    "description" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,

    CONSTRAINT "payment_request_realizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_request_events" (
    "id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "from_status" "RequestStatus",
    "to_status" "RequestStatus" NOT NULL,
    "action" TEXT NOT NULL,
    "note" TEXT,
    "actor_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_request_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transactions" (
    "id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "project_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "kind" "TransactionKind" NOT NULL,
    "account_id" UUID,
    "method" "PaymentMethod" NOT NULL DEFAULT 'transfer',
    "amount" BIGINT NOT NULL,
    "description" TEXT NOT NULL,
    "party_id" UUID,
    "party_name" TEXT,
    "reference" TEXT,
    "status" "TransactionStatus" NOT NULL DEFAULT 'menunggu_verifikasi',
    "status_note" TEXT,
    "request_id" UUID,
    "created_by_id" UUID NOT NULL,
    "verified_by_id" UUID,
    "verified_at" TIMESTAMPTZ,
    "legacy_id" INTEGER,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transaction_items" (
    "id" UUID NOT NULL,
    "transaction_id" UUID NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "category_id" UUID,
    "description" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,

    CONSTRAINT "transaction_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attachments" (
    "id" UUID NOT NULL,
    "kind" "AttachmentKind" NOT NULL DEFAULT 'nota',
    "request_id" UUID,
    "transaction_id" UUID,
    "file_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "storage_key" TEXT NOT NULL,
    "uploaded_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "href" TEXT,
    "read_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "counters" (
    "key" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "counters_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "org_name" TEXT NOT NULL DEFAULT 'Bintang',
    "finance_approve_cap" BIGINT NOT NULL DEFAULT 0,
    "require_proof" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "action" TEXT NOT NULL,
    "resource_type" TEXT NOT NULL,
    "resource_id" TEXT,
    "payload" JSONB,
    "ip" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_legacy_id_key" ON "users"("legacy_id");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE INDEX "login_attempts_identifier_ip_created_at_idx" ON "login_attempts"("identifier", "ip", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "companies_legacy_id_key" ON "companies"("legacy_id");

-- CreateIndex
CREATE UNIQUE INDEX "projects_code_key" ON "projects"("code");

-- CreateIndex
CREATE UNIQUE INDEX "projects_legacy_id_key" ON "projects"("legacy_id");

-- CreateIndex
CREATE INDEX "projects_status_idx" ON "projects"("status");

-- CreateIndex
CREATE INDEX "project_members_user_id_idx" ON "project_members"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "project_members_project_id_user_id_key" ON "project_members"("project_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "categories_legacy_id_key" ON "categories"("legacy_id");

-- CreateIndex
CREATE UNIQUE INDEX "categories_direction_name_key" ON "categories"("direction", "name");

-- CreateIndex
CREATE UNIQUE INDEX "parties_legacy_id_key" ON "parties"("legacy_id");

-- CreateIndex
CREATE INDEX "parties_name_idx" ON "parties"("name");

-- CreateIndex
CREATE UNIQUE INDEX "payment_requests_number_key" ON "payment_requests"("number");

-- CreateIndex
CREATE UNIQUE INDEX "payment_requests_legacy_id_key" ON "payment_requests"("legacy_id");

-- CreateIndex
CREATE INDEX "payment_requests_status_idx" ON "payment_requests"("status");

-- CreateIndex
CREATE INDEX "payment_requests_project_id_status_idx" ON "payment_requests"("project_id", "status");

-- CreateIndex
CREATE INDEX "payment_requests_requester_id_status_idx" ON "payment_requests"("requester_id", "status");

-- CreateIndex
CREATE INDEX "payment_request_items_request_id_idx" ON "payment_request_items"("request_id");

-- CreateIndex
CREATE INDEX "payment_request_realizations_request_id_idx" ON "payment_request_realizations"("request_id");

-- CreateIndex
CREATE INDEX "payment_request_events_request_id_created_at_idx" ON "payment_request_events"("request_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "transactions_number_key" ON "transactions"("number");

-- CreateIndex
CREATE UNIQUE INDEX "transactions_legacy_id_key" ON "transactions"("legacy_id");

-- CreateIndex
CREATE INDEX "transactions_project_id_date_idx" ON "transactions"("project_id", "date");

-- CreateIndex
CREATE INDEX "transactions_status_kind_idx" ON "transactions"("status", "kind");

-- CreateIndex
CREATE INDEX "transactions_account_id_idx" ON "transactions"("account_id");

-- CreateIndex
CREATE INDEX "transactions_request_id_idx" ON "transactions"("request_id");

-- CreateIndex
CREATE INDEX "transaction_items_transaction_id_idx" ON "transaction_items"("transaction_id");

-- CreateIndex
CREATE INDEX "transaction_items_category_id_idx" ON "transaction_items"("category_id");

-- CreateIndex
CREATE UNIQUE INDEX "attachments_storage_key_key" ON "attachments"("storage_key");

-- CreateIndex
CREATE INDEX "attachments_request_id_idx" ON "attachments"("request_id");

-- CreateIndex
CREATE INDEX "attachments_transaction_id_idx" ON "attachments"("transaction_id");

-- CreateIndex
CREATE INDEX "notifications_user_id_read_at_created_at_idx" ON "notifications"("user_id", "read_at", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_resource_type_resource_id_idx" ON "audit_logs"("resource_type", "resource_id");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");

-- CreateIndex
CREATE INDEX "audit_logs_user_id_idx" ON "audit_logs"("user_id");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_party_id_fkey" FOREIGN KEY ("party_id") REFERENCES "parties"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_requester_id_fkey" FOREIGN KEY ("requester_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_approver_id_fkey" FOREIGN KEY ("approver_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_payer_id_fkey" FOREIGN KEY ("payer_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_request_items" ADD CONSTRAINT "payment_request_items_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "payment_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_request_items" ADD CONSTRAINT "payment_request_items_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_request_realizations" ADD CONSTRAINT "payment_request_realizations_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "payment_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_request_realizations" ADD CONSTRAINT "payment_request_realizations_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_request_events" ADD CONSTRAINT "payment_request_events_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "payment_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_request_events" ADD CONSTRAINT "payment_request_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_party_id_fkey" FOREIGN KEY ("party_id") REFERENCES "parties"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "payment_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_verified_by_id_fkey" FOREIGN KEY ("verified_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction_items" ADD CONSTRAINT "transaction_items_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction_items" ADD CONSTRAINT "transaction_items_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "payment_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────
-- Pagar integritas di level DB (tambahan manual).
-- Validasi Zod di server action adalah pagar pertama; ini pagar terakhir
-- untuk bug ORM / SQL langsung.
-- ─────────────────────────────────────────────────────────────
ALTER TABLE "transactions" ADD CONSTRAINT "ck_transactions_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "transaction_items" ADD CONSTRAINT "ck_transaction_items_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "payment_requests" ADD CONSTRAINT "ck_payment_requests_total_nonneg" CHECK ("total" >= 0);
ALTER TABLE "payment_request_items" ADD CONSTRAINT "ck_payment_request_items_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "payment_request_realizations" ADD CONSTRAINT "ck_realizations_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "projects" ADD CONSTRAINT "ck_projects_money_nonneg" CHECK ("contract_value" >= 0 AND "budget" >= 0);
ALTER TABLE "attachments" ADD CONSTRAINT "ck_attachments_one_owner"
  CHECK (("request_id" IS NOT NULL)::int + ("transaction_id" IS NOT NULL)::int = 1);
ALTER TABLE "settings" ADD CONSTRAINT "ck_settings_singleton" CHECK ("id" = 1);

-- Jejak audit & riwayat pengajuan = append-only.
CREATE OR REPLACE FUNCTION bintang_tolak_ubah() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Tabel % bersifat append-only', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_audit_logs_append_only
  BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION bintang_tolak_ubah();

-- Riwayat pengajuan boleh ikut terhapus bersama draft induknya (CASCADE dari
-- penghapusan draft), tapi tidak boleh diubah.
CREATE TRIGGER trg_payment_request_events_no_update
  BEFORE UPDATE ON "payment_request_events"
  FOR EACH ROW EXECUTE FUNCTION bintang_tolak_ubah();

INSERT INTO "settings" ("id", "updated_at") VALUES (1, now()) ON CONFLICT DO NOTHING;
