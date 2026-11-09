# Status pemutakhiran dependency

Terakhir diverifikasi: **2026-09-04**.

Tidak ada pemutakhiran mayor yang sengaja ditunda. Frontend sudah
dimigrasikan dan dikunci dengan `pnpm-lock.yaml` pada baseline berikut:

- React 19.2, React Router 8.3 (paket ESM `react-router`)
- Vite 8.2 + plugin React 6.1 + Tailwind CSS 4.3
- Recharts 3.10, Zod 4.5, Lucide React 1.40
- ESLint 10.9, Vitest 5.0
- TypeScript native 7.0 untuk `tsc`, berdampingan dengan API TypeScript
  6.0 (`@typescript/typescript6`) yang masih dibutuhkan typescript-eslint

Backend dikunci dengan `uv.lock`; Docker dan CI memakai mode `--frozen`.
Dependabot tetap memantau ekosistem npm/pnpm, pip, Docker, dan Actions.

## Verifikasi wajib setelah pembaruan

```bash
cd frontend-v2
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm run lint
pnpm run test
pnpm run build

cd ../backend
uv sync --frozen --extra dev
uv run ruff check app tests
uv run pytest -q
```

Jangan memperbarui manifest tanpa lockfile. Untuk TypeScript 7, pertahankan
alias TypeScript 6 sampai typescript-eslint mendukung API native secara resmi.
