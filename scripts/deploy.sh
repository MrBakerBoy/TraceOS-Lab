#!/bin/bash
# =============================================================================
# TraceOS Lab - 一键部署脚本
# =============================================================================
#
# 使用方式：
#   ./scripts/deploy.sh           # 部署全部 (基础设施 + 应用 + 监控)
#   ./scripts/deploy.sh infra     # 仅基础设施
#   ./scripts/deploy.sh app       # 基础设施 + 应用
#   ./scripts/deploy.sh monitor   # 基础设施 + 监控
#   ./scripts/deploy.sh down      # 停止所有服务
#   ./scripts/deploy.sh status    # 查看服务状态
#   ./scripts/deploy.sh logs      # 查看实时日志
#
# =============================================================================

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

# 项目根目录
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

# =============================================================================
# 辅助函数
# =============================================================================

print_banner() {
    echo ""
    echo -e "${CYAN}╔══════════════════════════════════════════════════╗${NC}"
    echo -e "${CYAN}║          TraceOS Lab - 容器化部署               ║${NC}"
    echo -e "${CYAN}╚══════════════════════════════════════════════════╝${NC}"
    echo ""
}

log_info()    { echo -e "${GREEN}[✓]${NC} $1"; }
log_warn()    { echo -e "${YELLOW}[!]${NC} $1"; }
log_error()   { echo -e "${RED}[✗]${NC} $1"; }
log_step()    { echo -e "\n${BLUE}▸${BOLD} $1${NC}"; }

# =============================================================================
# 环境检查
# =============================================================================

check_docker() {
    log_step "检查 Docker 环境"

    if ! command -v docker &> /dev/null; then
        log_error "Docker 未安装"
        echo "  安装指南: https://docs.docker.com/get-docker/"
        echo "  WSL2 用户: 安装 Docker Desktop for Windows 即可"
        exit 1
    fi

    if ! docker info &> /dev/null 2>&1; then
        log_error "Docker 守护进程未运行"
        echo "  请启动 Docker Desktop 或执行: sudo systemctl start docker"
        exit 1
    fi

    if ! docker compose version &> /dev/null; then
        log_error "Docker Compose V2 未安装"
        echo "  请升级 Docker Desktop 或安装 docker-compose-plugin"
        exit 1
    fi

    log_info "Docker $(docker --version | awk '{print $3}' | tr -d ',')"
    log_info "Compose $(docker compose version --short)"
}

# =============================================================================
# 环境配置
# =============================================================================

setup_env() {
    log_step "配置环境变量"

    if [ ! -f ".env" ]; then
        if [ -f ".env.template" ]; then
            cp .env.template .env
            log_info "已从 .env.template 创建 .env"
            log_warn "请编辑 .env 配置生产密钥 (JWT_SECRET, API Keys 等)"
        elif [ -f ".env.example" ]; then
            cp .env.example .env
            log_info "已从 .env.example 创建 .env"
            log_warn "请编辑 .env 配置生产密钥 (JWT_SECRET, API Keys 等)"
        else
            log_error "未找到 .env.template 或 .env.example"
            echo "  请手动创建 .env 文件"
            exit 1
        fi
    else
        log_info ".env 已存在，跳过创建"
    fi

    # 自动生成 JWT_SECRET (如果还是默认值)
    if grep -q "JWT_SECRET=change-me" .env 2>/dev/null; then
        JWT=$(openssl rand -base64 32 2>/dev/null || head -c 32 /dev/urandom | base64)
        if [ -n "$JWT" ]; then
            sed -i "s|JWT_SECRET=change-me-to-a-random-secret-key|JWT_SECRET=${JWT}|" .env
            log_info "已自动生成 JWT_SECRET"
        fi
    fi
}

# =============================================================================
# 构建
# =============================================================================

build_images() {
    log_step "构建 Docker 镜像"

    docker compose build --parallel 2>&1 | while IFS= read -r line; do
        echo "  $line"
    done

    log_info "镜像构建完成"
}

# =============================================================================
# 部署
# =============================================================================

deploy_full() {
    log_step "部署全部服务 (基础设施 + 应用 + 监控)"

    docker compose \
        --profile app \
        --profile monitoring \
        up -d --build

    log_info "全部服务已启动"
}

deploy_infra() {
    log_step "部署基础设施 (PostgreSQL, Redis, MinIO, NATS, Traefik)"

    docker compose up -d

    log_info "基础设施已启动"
}

deploy_app() {
    log_step "部署基础设施 + 应用服务"

    docker compose \
        --profile app \
        up -d --build

    log_info "应用服务已启动"
}

deploy_monitor() {
    log_step "部署基础设施 + 监控栈"

    docker compose \
        --profile monitoring \
        up -d

    log_info "监控栈已启动"
}

# =============================================================================
# 等待服务就绪
# =============================================================================

wait_for_services() {
    log_step "等待服务就绪"

    echo -n "  PostgreSQL "
    local retries=0
    until docker compose exec -T postgres pg_isready -U traceos &> /dev/null; do
        echo -n "."
        retries=$((retries + 1))
        if [ $retries -ge 30 ]; then
            echo ""
            log_warn "PostgreSQL 启动超时，请手动检查"
            return
        fi
        sleep 2
    done
    echo -e " ${GREEN}就绪${NC}"

    echo -n "  Redis      "
    retries=0
    until docker compose exec -T redis redis-cli ping &> /dev/null 2>&1; do
        echo -n "."
        retries=$((retries + 1))
        if [ $retries -ge 15 ]; then
            echo ""
            log_warn "Redis 启动超时"
            return
        fi
        sleep 1
    done
    echo -e " ${GREEN}就绪${NC}"
}

# =============================================================================
# 状态信息
# =============================================================================

print_status() {
    echo ""
    echo -e "${BOLD}📊 服务状态${NC}"
    docker compose --profile app --profile monitoring ps
}

print_access() {
    echo ""
    echo -e "${BOLD}🌐 访问地址${NC}"
    echo -e "  ${CYAN}─────────────────────────────────────────${NC}"
    echo -e "  前端:           http://localhost"
    echo -e "  Core API:       http://localhost/api/v1/"
    echo -e "  AI API:         http://localhost/api/ai/"
    echo -e "  Traefik 面板:   http://localhost:8080"
    echo -e "  ${CYAN}─────────────────────────────────────────${NC}"
    echo -e "  MinIO 控制台:   http://localhost:9001  ${YELLOW}(traceos / traceos_dev)${NC}"
    echo -e "  Grafana:        http://localhost:3001  ${YELLOW}(admin / admin)${NC}"
    echo -e "  Prometheus:     http://localhost:9090"
    echo -e "  Jaeger:         http://localhost:16686"
    echo -e "  ${CYAN}─────────────────────────────────────────${NC}"
    echo -e "  PostgreSQL:     localhost:5432  ${YELLOW}(traceos / traceos_dev)${NC}"
    echo -e "  Redis:          localhost:6379"
    echo -e "  NATS Monitor:   localhost:8222"
    echo ""
}

# =============================================================================
# 控制命令
# =============================================================================

stop_all() {
    log_step "停止所有服务"
    docker compose --profile app --profile monitoring down
    log_info "所有服务已停止"
}

destroy_all() {
    log_step "停止并清除所有数据卷"
    log_warn "这将删除所有持久化数据！"
    read -p "确认？(y/N) " -n 1 -r
    echo ""
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        docker compose --profile app --profile monitoring down -v
        log_info "所有服务和数据卷已清除"
    else
        log_info "已取消"
    fi
}

show_logs() {
    docker compose --profile app --profile monitoring logs -f
}

# =============================================================================
# 主流程
# =============================================================================

print_banner

case "${1:-full}" in
    full)
        check_docker
        setup_env
        build_images
        deploy_full
        wait_for_services
        print_status
        print_access
        ;;
    infra)
        check_docker
        setup_env
        deploy_infra
        wait_for_services
        print_status
        echo ""
        echo -e "  ${CYAN}基础设施已启动。启动应用: ./scripts/deploy.sh app${NC}"
        echo ""
        ;;
    app)
        check_docker
        setup_env
        deploy_app
        wait_for_services
        print_status
        print_access
        ;;
    monitor)
        check_docker
        setup_env
        deploy_monitor
        wait_for_services
        print_status
        echo ""
        echo -e "  ${CYAN}监控栈已启动。${NC}"
        echo -e "  Grafana:    http://localhost:3001"
        echo -e "  Prometheus: http://localhost:9090"
        echo -e "  Jaeger:     http://localhost:16686"
        echo ""
        ;;
    down)
        stop_all
        ;;
    destroy)
        destroy_all
        ;;
    status)
        print_status
        print_access
        ;;
    logs)
        show_logs
        ;;
    *)
        echo -e "${BOLD}用法:${NC} $0 [command]"
        echo ""
        echo "命令:"
        echo "  full     部署全部 (基础设施 + 应用 + 监控)  [默认]"
        echo "  infra    仅基础设施"
        echo "  app      基础设施 + 应用服务"
        echo "  monitor  基础设施 + 监控栈"
        echo "  down     停止所有服务"
        echo "  destroy  停止并清除所有数据"
        echo "  status   查看服务状态"
        echo "  logs     查看实时日志"
        ;;
esac
