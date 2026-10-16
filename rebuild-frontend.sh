#!/bin/bash
# =============================================================================
# TraceOS Lab - Frontend Rebuild Script
# =============================================================================
# 用法: ./rebuild-frontend.sh
# 在宿主机构建 Next.js，然后重建容器运行 next start
# =============================================================================
set -e

COMPOSE_FILES="-f docker-compose.yml -f docker-compose.dev.yml"
FRONTEND_DIR="/root/traceos-lab/frontend"

echo "[rebuild] === 第1步: 宿主机构建 (next build) ==="
cd "$FRONTEND_DIR"
rm -rf .next
NODE_OPTIONS='--max-old-space-size=3072' npm run build

echo ""
echo "[rebuild] === 第1.5步: 准备 standalone 静态资源 ==="
mkdir -p "$FRONTEND_DIR/.next/standalone/.next"
rm -rf "$FRONTEND_DIR/.next/standalone/.next/static"
cp -a "$FRONTEND_DIR/.next/static" "$FRONTEND_DIR/.next/standalone/.next/static"
rm -rf "$FRONTEND_DIR/.next/standalone/public"
cp -a "$FRONTEND_DIR/public" "$FRONTEND_DIR/.next/standalone/public"

echo ""
echo "[rebuild] === 第2步: 重建并启动 frontend 容器 ==="
cd /root/traceos-lab
docker compose $COMPOSE_FILES stop frontend 2>/dev/null || true
docker compose $COMPOSE_FILES rm -f frontend 2>/dev/null || true
docker compose $COMPOSE_FILES up -d frontend

echo ""
echo "[rebuild] 完成! 容器状态:"
docker ps --filter name=frontend --format "table {{.Names}}\t{{.Status}}\t{{.Image}}"

echo ""
echo "[rebuild] 验证: curl -s -o /dev/null -w 'HTTP %{http_code}' http://localhost:3000/"