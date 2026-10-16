# =============================================================================
# TraceOS Lab - AI Service Dockerfile v2.2 (torch CPU via PyPI index)
# =============================================================================

FROM python:3.11-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_DEFAULT_TIMEOUT=300 \
    HF_ENDPOINT=https://hf-mirror.com

# NOTE: No global PIP_INDEX_URL — each pip install explicitly sets its own index,
# preventing accidental torch CUDA overwrites from mirror indexes.

WORKDIR /app

RUN sed -i 's/deb.debian.org/mirrors.cloud.aliyuncs.com/g' /etc/apt/sources.list.d/debian.sources 2>/dev/null || true; \
    apt-get update && apt-get install -y --no-install-recommends \
    curl git build-essential \
    && rm -rf /var/lib/apt/lists/*

# Cache bust: 2026-03-14-v3-pypi-cpu
COPY requirements.txt .

# Step 1: Install torch CPU-only from PyTorch official CPU index.
# The CPU index ships the full dependency tree (torch/numpy/sympy/
# typing-extensions/...), verified reachable; avoids CUDA wheel bloat.
RUN pip install --no-cache-dir --default-timeout=600 \
    --index-url https://download.pytorch.org/whl/cpu \
    torch torchvision torchaudio

# Step 2: Pin torch versions to prevent pip from "upgrading" to CUDA wheels
# when sentence-transformers triggers a torch dependency re-resolution.
# Then install remaining deps from aliyun mirror (国内镜像加速).
RUN pip freeze | grep -E '^(torch|torchvision|torchaudio)' > /tmp/torch-constraints.txt \
    && pip install --no-cache-dir --default-timeout=300 \
    --index-url https://mirrors.cloud.aliyuncs.com/pypi/simple/ \
    --constraint /tmp/torch-constraints.txt \
    -r requirements.txt \
    && apt-get purge -y git build-essential \
    && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/*

# NOTE: BAAI/bge-m3 model (~2.5GB) is NOT baked into the image.
# It downloads lazily at first runtime via HF_ENDPOINT (hf-mirror.com).
# This saves ~600MB in image size and prevents disk exhaustion during build.

COPY . .

EXPOSE 8000

HEALTHCHECK --interval=10s --timeout=5s --retries=3 --start-period=30s \
    CMD curl -sf http://localhost:8000/healthz || exit 1

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
