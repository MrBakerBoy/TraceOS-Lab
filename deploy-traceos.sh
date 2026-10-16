#!/bin/bash
# =============================================================================
# TraceOS Lab — 全项目一键部署脚本
# 部署内容: PostgreSQL + Redis + NATS + MinIO + Core Service + AI Service + Frontend
#
# 使用方式:
#   1. 上传项目: scp -r ./traceos-lab baker@服务器IP:~/traceos-lab
#   2. SSH 登录: ssh baker@服务器IP
#   3. 执行: cd ~/traceos-lab && chmod +x deploy-traceos.sh && ./deploy-traceos.sh
# =============================================================================

set -euo pipefail

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'

log()  { echo -e "${GREEN}[✓]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
err()  { echo -e "${RED}[✗]${NC} $1"; }
info() { echo -e "${CYAN}[i]${NC} $1"; }

echo ""
echo "============================================"
echo "  TraceOS Lab 全项目部署"
echo "  基础设施 + 后端服务 + AI 诊断 + 前端"
echo "============================================"
echo ""

# ------------------------------------------
# 1. 系统准备
# ------------------------------------------
info "检查系统环境..."

# 检查是否为 root 或有 sudo
if [ "$EUID" -eq 0 ]; then
    SUDO=""
else
    SUDO="sudo"
fi

# ------------------------------------------
# 2. 安装 Docker
# ------------------------------------------
if command -v docker &>/dev/null; then
    log "Docker 已安装: $(docker --version)"
else
    info "安装 Docker..."
    curl -fsSL https://get.docker.com | $SUDO sh
    $SUDO systemctl enable docker
    $SUDO systemctl start docker
    $SUDO usermod -aG docker $USER
    log "Docker 安装完成"
    warn "如果当前用户不在 docker 组，请重新登录后再运行此脚本"
fi

# 检查 Docker Compose
if docker compose version &>/dev/null; then
    log "Docker Compose 已安装: $(docker compose version --short)"
else
    info "安装 Docker Compose plugin..."
    $SUDO apt-get update -qq
    $SUDO apt-get install -y docker-compose-plugin
    log "Docker Compose 安装完成"
fi

# ------------------------------------------
# 3. 检查项目文件
# ------------------------------------------
if [ ! -f "docker-compose.yml" ]; then
    err "找不到 docker-compose.yml，请在项目根目录运行此脚本"
    exit 1
fi

PROJECT_DIR="$(pwd)"
log "项目目录: $PROJECT_DIR"

# ------------------------------------------
# 4. 配置 .env
# ------------------------------------------
if [ ! -f .env ]; then
    if [ -f .env.template ]; then
        cp .env.template .env
    elif [ -f .env.example ]; then
        cp .env.example .env
    fi
    warn "已创建 .env，请检查配置"
fi

# 确保 MIMO_API_KEY 已配置
if ! grep -q "^MIMO_API_KEY=" .env 2>/dev/null; then
    cat >> .env << 'ENVEOF'

# Mimo AI 诊断
MIMO_API_KEY=tp-crpb81voag4eeini1zzxr2h0fbyop8nyrxy21pohcsc2vu5v
MIMO_API_BASE_URL=https://open.mimoai.com/v1
MIMO_MODEL=mimo-chat
ENVEOF
    log "已添加 MIMO_API_KEY 到 .env"
else
    log "MIMO_API_KEY 已配置"
fi

# ------------------------------------------
# 5. 防火墙配置
# ------------------------------------------
info "配置防火墙..."
if command -v ufw &>/dev/null; then
    $SUDO ufw allow 22/tcp    2>/dev/null || true
    $SUDO ufw allow 80/tcp    2>/dev/null || true
    $SUDO ufw allow 443/tcp   2>/dev/null || true
    $SUDO ufw allow 8000/tcp  2>/dev/null || true
    $SUDO ufw allow 8080/tcp  2>/dev/null || true
    $SUDO ufw allow 8081/tcp  2>/dev/null || true
    log "UFW 防火墙端口已放行"
elif command -v firewall-cmd &>/dev/null; then
    for port in 22 80 443 8000 8080 8081; do
        $SUDO firewall-cmd --permanent --add-port=${port}/tcp 2>/dev/null || true
    done
    $SUDO firewall-cmd --reload 2>/dev/null || true
    log "firewalld 端口已放行"
fi

# ------------------------------------------
# 6. 启动基础设施
# ------------------------------------------
echo ""
info "启动基础设施 (PostgreSQL, Redis, NATS, MinIO)..."
docker compose up -d postgres redis nats minio

info "等待基础设施就绪..."
READY=0
for i in $(seq 1 30); do
    PG_OK=$(docker compose ps postgres --format '{{.Health}}' 2>/dev/null || echo "")
    REDIS_OK=$(docker compose ps redis --format '{{.Health}}' 2>/dev/null || echo "")
    if echo "$PG_OK" | grep -qi "healthy" && echo "$REDIS_OK" | grep -qi "healthy"; then
        READY=1
        break
    fi
    printf "."
    sleep 2
done
echo ""

if [ "$READY" -eq 1 ]; then
    log "基础设施就绪"
else
    warn "基础设施可能未完全就绪，继续启动应用..."
fi

# ------------------------------------------
# 7. 构建并启动应用服务
# ------------------------------------------
echo ""
info "构建并启动应用服务 (Core + AI + Frontend)..."
info "首次构建需要几分钟，请耐心等待..."
docker compose --profile app up -d --build 2>&1 | tail -20

echo ""
info "等待服务启动..."
sleep 15

# ------------------------------------------
# 8. 健康检查
# ------------------------------------------
echo ""
echo "============================================"
echo "  服务状态"
echo "============================================"
docker compose ps --format "table {{.Name}}\t{{.Status}}\t{{.Ports}}" 2>/dev/null || docker compose ps

echo ""
echo "============================================"
echo "  端点测试"
echo "============================================"

test_endpoint() {
    local name=$1
    local url=$2
    if curl -sf --max-time 5 "$url" >/dev/null 2>&1; then
        echo -e "  ${GREEN}✓${NC} $name — 正常"
    else
        echo -e "  ${YELLOW}⏳${NC} $name — 启动中或暂不可达"
    fi
}

test_endpoint "AI Service"   "http://localhost:8000/healthz"
test_endpoint "Core Service" "http://localhost:8080/healthz" || true
test_endpoint "Frontend"     "http://localhost:8081" || true

# ------------------------------------------
# 9. 完成
# ------------------------------------------
SERVER_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "YOUR_SERVER_IP")

echo ""
echo "============================================"
echo -e "  ${GREEN}部署完成！${NC}"
echo "============================================"
echo ""
echo "  🌐 前端界面:    http://$SERVER_IP:8081"
echo "  🔧 Core API:    http://$SERVER_IP:8080"
echo "  🤖 AI Service:  http://$SERVER_IP:8000"
echo ""
echo "  📋 常用命令:"
echo "     查看日志:     docker compose logs -f ai-service"
echo "     重启服务:     docker compose --profile app restart"
echo "     停止所有:     docker compose --profile app down"
echo "     查看状态:     docker compose ps"
echo ""
echo "  🧪 测试 AI 诊断:"
echo "     curl -X POST http://localhost:8000/api/ai/diagnose \\"
echo "       -H 'Content-Type: application/json' \\"
echo "       -d '{\"submission_id\":\"test\",\"experiment_id\":\"test\",\"student_id\":\"test\"}'"
echo ""
