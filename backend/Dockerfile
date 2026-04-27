FROM python:3.13-slim

# WeasyPrint native deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpango-1.0-0 libpangoft2-1.0-0 libcairo2 libgdk-pixbuf-2.0-0 \
    libffi-dev libssl-dev shared-mime-info fonts-dejavu-core \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY pyproject.toml README.md ./
COPY app ./app
RUN pip install --no-cache-dir uv \
 && uv pip install --system --no-cache .

ENV PYTHONUNBUFFERED=1 \
    UPLOAD_DIR=/data/uploads \
    PORT=8000
RUN mkdir -p /data/uploads

EXPOSE 8000
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT}"]
