-- AlterTable
ALTER TABLE "attachments" ADD COLUMN     "label" TEXT,
ADD COLUMN     "project_id" UUID;

-- CreateIndex
CREATE INDEX "attachments_project_id_idx" ON "attachments"("project_id");

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Pemilik lampiran tepat satu dari tiga: pengajuan, transaksi, proyek.
ALTER TABLE "attachments" DROP CONSTRAINT IF EXISTS "ck_attachments_one_owner";
ALTER TABLE "attachments" ADD CONSTRAINT "ck_attachments_one_owner"
  CHECK (("request_id" IS NOT NULL)::int + ("transaction_id" IS NOT NULL)::int + ("project_id" IS NOT NULL)::int = 1);
