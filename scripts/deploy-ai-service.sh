#!/bin/bash
# =============================================================================
# TraceOS Lab — 一键部署脚本 (Linux 云服务器)
# 使用方式: chmod +x scripts/deploy-ai-service.sh && ./scripts/deploy-ai-service.sh
# =============================================================================

set -euo pipefail

echo "============================================"
echo "  TraceOS Lab 一键部署"
echo "============================================"

# 1. 检查 Docker
if ! command -v docker &>/dev/null; then
    echo "📦 安装 Docker..."
    curl -fsSL https://get.docker.com | sh
    sudo systemctl enable docker
    sudo systemctl start docker
    echo "✅ Docker 安装完成"
else
    echo "✅ Docker 已安装: $(docker --version)"
fi

# 2. 检查 Docker Compose
if ! docker compose version &>/dev/null; then
    echo "📦 安装 Docker Compose plugin..."
    sudo apt-get update && sudo apt-get install -y docker-compose-plugin
    echo "✅ Docker Compose 安装完成"
else
    echo "✅ Docker Compose 已安装: $(docker compose version --short)"
fi

# 3. 检查 .env
if [ ! -f .env ]; then
    echo "❌ .env 文件不存在，请先配置"
    exit 1
fi

# 确保 MIMO_API_KEY 已设置
if ! grep -q "MIMO_API_KEY=tp-" .env; then
    echo "⚠️  .env 中未找到 MIMO_API_KEY，请确认已配置"
fi

echo ""
echo "🚀 启动基础设施 + 应用服务..."
echo "   (首次运行需要拉取镜像，请耐心等待)"
echo ""

# 4. 启动基础设施
docker compose up -d postgres redis nats minio
echo "⏳ 等待基础设施就绪..."
sleep 10

# 5. 启动应用服务
docker compose --profile app up -d

echo ""
echo "⏳ 等待服务启动..."
sleep 15

# 6. 健康检查
echo ""
echo "============================================"
echo "  健康检查"
echo "============================================"

for svc in postgres redis nats core-service ai-service; do
    echo -n "  $svc: "
    if docker compose ps --format json 2>/dev/null | grep -q "\"$svc\".*\"running\"" 2>/dev/null; then
        echo "✅ 运行中"
    else
        echo "⏳ 启动中..."
    fi
done

echo ""
echo "============================================"
echo "  部署完成！"
echo "============================================"
echo ""
echo "  前端:        http://$(hostname -I | awk '{print $1}'):8081"
echo "  AI Service:  http://$(hostname -I | awk '{print $1}'):8000"
echo "  Core Service: http://$(hostname -I | awk '{print $1}'):8080"
echo ""
echo "  测试 AI 诊断:"
echo "  curl -X POST http://localhost:8000/api/ai/diagnose \\"
echo "    -H 'Content-Type: application/json' \\"
echo "    -d '{\"submission_id\":\"test\",\"experiment_id\":\"test\",\"student_id\":\"test\"}'"
echo ""
echo "  查看日志:"
echo "  docker compose logs -f ai-service"
