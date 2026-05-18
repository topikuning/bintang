#!/usr/bin/env bash
# Install git pre-commit hook -- cegah commit dgn lint/type error.
#
# Usage (one-time): bash scripts/install-git-hooks.sh
# Run dari root repo.
#
# Hook akan jalan otomatis di setiap `git commit`:
# - Ruff lint backend/app/ (kalau ada file Python yg di-stage)
# - tsc + eslint frontend-v2/ (kalau ada file TS/TSX yg di-stage)
#
# Bypass darurat: git commit --no-verify  (BUKAN best practice).

set -e

REPO_ROOT="$(git rev-parse --show-toplevel)"
HOOK="$REPO_ROOT/.git/hooks/pre-commit"

cat > "$HOOK" <<'EOF'
#!/usr/bin/env bash
# Pre-commit hook -- auto-installed via scripts/install-git-hooks.sh.
# Cegah commit kalau lint/type fail.
set -e

ROOT="$(git rev-parse --show-toplevel)"
STAGED=$(git diff --cached --name-only --diff-filter=ACM)

run_check() {
  local label="$1"
  shift
  echo "[pre-commit] $label..."
  if ! "$@"; then
    echo ""
    echo "[pre-commit] FAILED: $label"
    echo "[pre-commit] Fix, lalu git add + commit ulang."
    echo "[pre-commit] Bypass darurat: git commit --no-verify"
    exit 1
  fi
}

# --- Backend (Python) ---
if echo "$STAGED" | grep -qE '^backend/.*\.py$'; then
  if [ -d "$ROOT/backend/.venv" ]; then
    cd "$ROOT/backend"
    if [ -x ".venv/bin/ruff" ]; then
      run_check "ruff lint backend" .venv/bin/ruff check app
    fi
    cd "$ROOT"
  fi
fi

# --- Frontend (TS) ---
if echo "$STAGED" | grep -qE '^frontend-v2/.*\.(ts|tsx)$'; then
  if [ -d "$ROOT/frontend-v2/node_modules" ]; then
    cd "$ROOT/frontend-v2"
    run_check "tsc typecheck frontend" npx --no-install tsc -b --noEmit
    # ESLint soft -- soal di repo masih punya warning legacy.
    # Aktifkan strict setelah backlog dibersihkan:
    # run_check "eslint frontend" npx --no-install eslint . --max-warnings=0
    cd "$ROOT"
  fi
fi

echo "[pre-commit] OK"
EOF

chmod +x "$HOOK"
echo "Installed: $HOOK"
echo "Test: stage file, lalu git commit -- hook akan auto-jalan."
