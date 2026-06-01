FROM python:3.13-slim

# WeasyPrint native deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpango-1.0-0 libpangoft2-1.0-0 libcairo2 libgdk-pixbuf-2.0-0 \
    libffi-dev libssl-dev shared-mime-info fonts-dejavu-core \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY pyproject.toml README.md alembic.ini ./
COPY app ./app
# Network resilience: retry up to 5x kalau PyPI connection reset.
# UV_HTTP_TIMEOUT default 30s -- naikkan ke 120s utk koneksi lambat.
# UV_CONCURRENT_DOWNLOADS dibatasi supaya tdk overload mirror.
ENV UV_HTTP_TIMEOUT=120 \
    UV_CONCURRENT_DOWNLOADS=8 \
    PIP_DEFAULT_TIMEOUT=120 \
    PIP_RETRIES=5
RUN pip install --no-cache-dir uv && \
    ok=0; \
    for i in 1 2 3 4 5; do \
        if uv pip install --system --no-cache .; then ok=1; break; fi; \
        echo "uv pip install failed (attempt $i/5), retrying in $((i*5))s..."; \
        sleep $((i*5)); \
    done; \
    test "$ok" = "1"

ENV PYTHONUNBUFFERED=1 \
    UPLOAD_DIR=/data/uploads \
    PORT=8000
RUN mkdir -p /data/uploads

EXPOSE 8000
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT}"]
