/**
 * Galat yang PESANNYA aman ditampilkan ke pengguna. Dipisah dari modul
 * sesi/aksi supaya service bisa dipakai skrip & uji tanpa menyeret Next.
 */
export class ForbiddenError extends Error {
  constructor(message = "Anda tidak punya izin untuk aksi ini.") {
    super(message);
  }
}

export class PesanError extends Error {}
