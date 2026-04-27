# Bintang Backend

FastAPI backend untuk aplikasi pencatatan keuangan multi-proyek.

## Quick start (lokal, tanpa Docker)

```bash
# install uv (jika belum): https://docs.astral.sh/uv/
uv venv
source .venv/bin/activate
uv pip install -e ".[dev]"

# init db & seed demo data
alembic upgrade head
python -m app.seed

# run dev server
uvicorn app.main:app --reload --port 8000
```

Swagger UI: http://localhost:8000/docs

## Default credentials (dari seed)
- Superadmin: `admin@bintang.local` / `admin123`
- Project admin: `pm1@bintang.local` / `pm123`
