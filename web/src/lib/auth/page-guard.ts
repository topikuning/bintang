import { notFound } from "next/navigation";
import type { UserRole } from "@/generated/prisma/enums";
import { can, type Capability } from "@/lib/authz";

/** Guard halaman: tanpa capability → 404 (tidak membocorkan keberadaan halaman). */
export function requireCapabilityPage(role: UserRole, capability: Capability): void {
  if (!can(role, capability)) notFound();
}
