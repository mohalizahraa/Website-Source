# Backend API + in-process ingest worker.
# Build context MUST be the repo root (see render.yaml dockerContext) so that
# both server/ and the sibling pipeline/ package are available — app.ingest adds
# the repo root to sys.path and imports `pipeline`.
FROM python:3.12-slim

# poppler-utils provides pdftoppm/pdfinfo, which the OCR pipeline shells out to
# for PDF -> page-image rendering (pipeline/ocr/render.py). Only system dep.
RUN apt-get update \
    && apt-get install -y --no-install-recommends poppler-utils \
    && rm -rf /var/lib/apt/lists/*

# Both server/ and pipeline/ are copied beneath /app. Keep the repository root
# importable even when uvicorn starts from /app/server.
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PYTHONPATH=/app \
    HAYDARI_ENV=production

WORKDIR /app

# Install deps first for layer caching.
COPY server/requirements.txt ./server/requirements.txt
RUN pip install --no-cache-dir -r server/requirements.txt

# App code (see .dockerignore — the venv, dev DB, uploads, .env are excluded).
COPY server/ ./server/
COPY pipeline/ ./pipeline/

WORKDIR /app/server

# Render provides $PORT. Single uvicorn worker ONLY: the ingest queue and its
# worker thread live in-process (in-memory), so multiple workers would each hold
# a separate queue. Scale by vertical size, not replicas.
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
