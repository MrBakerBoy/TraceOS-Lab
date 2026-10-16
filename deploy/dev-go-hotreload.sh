#!/bin/sh
set -e
echo "[dev] Using Alpine mirrors..."
sed -i 's/dl-cdn.alpinelinux.org/mirrors.aliyun.com/g' /etc/apk/repositories
echo "[dev] Installing dependencies..."
# strace is required by the local sandbox backend for syscall tracing; without it
# the runner fails to execute student binaries and every test point scores 0.
apk add --no-cache inotify-tools gcc musl-dev strace 2>/dev/null

# Install air if not already present
if ! command -v air >/dev/null 2>&1; then
    echo "[dev] Installing Air (Go live-reload)..."
    GOPROXY=https://goproxy.cn,direct go install github.com/air-verse/air@v1.52.3
    cp /go/bin/air /usr/local/bin/air
fi

echo "[dev] Starting with Air (incremental hot-reload)..."
exec air

