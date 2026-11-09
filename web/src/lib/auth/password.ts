import { hash, verify } from "@node-rs/argon2";
import bcrypt from "bcryptjs";

// argon2id, parameter OWASP (m=19 MiB, t=2, p=1) – sama dengan MARLIN.
const ARGON2_OPTS = { memoryCost: 19456, timeCost: 2, parallelism: 1 };

export function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTS);
}

/** Hash bcrypt bawaan Bintang lama ($2a$/$2b$/$2y$). */
export function isLegacyHash(passwordHash: string): boolean {
  return /^\$2[aby]\$/.test(passwordHash);
}

/**
 * Verifikasi password. Hash bcrypt dari Bintang lama tetap diterima supaya
 * pengguna hasil impor bisa masuk dengan password lamanya; pemanggil wajib
 * mengganti hash-nya ke argon2id setelah berhasil (`needsRehash`).
 */
export async function verifyPassword(
  passwordHash: string,
  password: string,
): Promise<{ ok: boolean; needsRehash: boolean }> {
  try {
    if (isLegacyHash(passwordHash)) {
      const ok = await bcrypt.compare(password, passwordHash);
      return { ok, needsRehash: ok };
    }
    return { ok: await verify(passwordHash, password), needsRehash: false };
  } catch {
    return { ok: false, needsRehash: false };
  }
}
