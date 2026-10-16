#!/bin/bash

# TraceOS Lab 开发环境一键初始化脚本

set -e

echo "🔧 TraceOS Lab 开发环境初始化..."
echo ""

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 检查函数
check_command() {
    if command -v $1 &> /dev/null; then
        echo -e "${GREEN}✓${NC} $1 已安装: $($1 --version 2>/dev/null || $1 version 2>/dev/null || echo '版本信息获取失败')"
        return 0
    else
        echo -e "${YELLOW}✗${NC} $1 未安装"
        return 1
    fi
}

# 安装 Go
install_go() {
    echo ""
    echo "📦 安装 Go 1.22..."
    GO_VERSION="1.22.5"
    wget -q https://go.dev/dl/go${GO_VERSION}.linux-amd64.tar.gz -O /tmp/go.tar.gz
    sudo rm -rf /usr/local/go
    sudo tar -C /usr/local -xzf /tmp/go.tar.gz
    rm /tmp/go.tar.gz

    # 添加到 PATH
    if ! grep -q '/usr/local/go/bin' ~/.bashrc; then
        echo 'export PATH=$PATH:/usr/local/go/bin' >> ~/.bashrc
        echo 'export GOPATH=$HOME/go' >> ~/.bashrc
        echo 'export PATH=$PATH:$GOPATH/bin' >> ~/.bashrc
        source ~/.bashrc
    fi

    export PATH=$PATH:/usr/local/go/bin
    export GOPATH=$HOME/go
    export PATH=$PATH:$GOPATH/bin

    echo -e "${GREEN}✓${NC} Go 安装完成: $(go version)"
}

# 安装 Python 和 uv
install_python_uv() {
    echo ""
    echo "📦 检查 Python 3.11+..."
    if ! command -v python3.11 &> /dev/null; then
        echo "安装 Python 3.11..."
        sudo apt-get update -qq
        sudo apt-get install -y python3.11 python3.11-venv python3-pip
    fi
    echo -e "${GREEN}✓${NC} Python: $(python3.11 --version)"

    echo ""
    echo "📦 安装 uv (Python 包管理工具)..."
    if ! command -v uv &> /dev/null; then
        curl -LsSf https://astral.sh/uv/install.sh | sh
        source ~/.bashrc
    fi
    echo -e "${GREEN}✓${NC} uv: $(uv --version)"
}

# 安装 Node.js 和 pnpm
install_node_pnpm() {
    echo ""
    echo "📦 检查 Node.js 20+..."
    if ! command -v node &> /dev/null || [ "$(node --version | cut -d'v' -f2 | cut -d'.' -f1)" -lt 20 ]; then
        echo "安装 Node.js 20..."
        curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
        sudo apt-get install -y nodejs
    fi
    echo -e "${GREEN}✓${NC} Node.js: $(node --version)"

    echo ""
    echo "📦 检查 pnpm..."
    if ! command -v pnpm &> /dev/null; then
        echo "安装 pnpm..."
        npm install -g pnpm
    fi
    echo -e "${GREEN}✓${NC} pnpm: $(pnpm --version)"
}

# 安装 Go 开发工具
install_go_tools() {
    echo ""
    echo "📦 安装 Go 开发工具..."

    echo "安装 air (Go 热重载工具)..."
    go install github.com/air-verse/air@latest

    echo "安装 protoc 代码生成插件..."
    go install google.golang.org/protobuf/cmd/protoc-gen-go@latest
    go install google.golang.org/grpc/cmd/protoc-gen-go-grpc@latest
    go install github.com/grpc-ecosystem/grpc-gateway/v2/protoc-gen-openapiv2@latest

    echo -e "${GREEN}✓${NC} Go 开发工具安装完成"
}

# 安装 buf (Proto 管理工具)
install_buf() {
    echo ""
    echo "📦 检查 buf..."
    if ! command -v buf &> /dev/null; then
        echo "安装 buf..."
        curl -sSL "https://github.com/bufbuild/buf/releases/latest/download/buf-$(uname -s)-$(uname -m)" \
            -o /usr/local/bin/buf && chmod +x /usr/local/bin/buf
    fi
    echo -e "${GREEN}✓${NC} buf: $(buf version)"
}

# 检查 Docker
check_docker() {
    echo ""
    echo "🐳 检查 Docker..."
    if ! command -v docker &> /dev/null; then
        echo -e "${RED}✗${NC} Docker 未安装，请先安装 Docker Desktop for WSL2"
        echo "下载地址: https://www.docker.com/products/docker-desktop/"
        exit 1
    fi

    if ! docker info &> /dev/null; then
        echo -e "${RED}✗${NC} Docker 未运行，请启动 Docker Desktop"
        exit 1
    fi

    echo -e "${GREEN}✓${NC} Docker: $(docker --version)"
    echo -e "${GREEN}✓${NC} Docker Compose: $(docker compose version)"
}

# 验证 nsjail
check_nsjail() {
    echo ""
    echo "🛡️ 检查 nsjail..."
    if command -v nsjail &> /dev/null; then
        echo -e "${GREEN}✓${NC} nsjail: $(nsjail --version 2>&1 | head -1)"

        # 测试隔离功能
        if nsjail --config /dev/null -- /bin/echo "nsjail working!" &> /dev/null; then
            echo -e "${GREEN}✓${NC} nsjail 隔离测试通过"
        else
            echo -e "${YELLOW}⚠${NC} nsjail 隔离测试失败，可能需要 sudo 权限"
        fi
    else
        echo -e "${YELLOW}⚠${NC} nsjail 未安装，正在安装..."
        sudo apt-get update -qq
        sudo apt-get install -y autoconf automake libtool pkg-config \
            libprotobuf-dev protobuf-compiler libnl-route-3-dev \
            libnl-3-dev libcap-dev
        git clone https://github.com/google/nsjail.git /tmp/nsjail
        cd /tmp/nsjail && make && sudo cp nsjail /usr/local/bin/
        cd - && rm -rf /tmp/nsjail
        echo -e "${GREEN}✓${NC} nsjail 安装完成"
    fi
}

# 验证系统工具
check_system_tools() {
    echo ""
    echo "🔧 验证系统工具..."

    tools=("strace" "perf" "make" "git" "vim" "curl")
    for tool in "${tools[@]}"; do
        if command -v $tool &> /dev/null; then
            echo -e "${GREEN}✓${NC} $tool"
        else
            echo -e "${YELLOW}✗${NC} $tool 未安装"
        fi
    done

    # 检查 cgroups v2
    if stat -f -c %T /sys/fs/cgroup/ 2>/dev/null | grep -q "cgroup2fs"; then
        echo -e "${GREEN}✓${NC} cgroups v2"
    else
        echo -e "${YELLOW}⚠${NC} cgroups v2 未启用"
    fi

    # 检查内核版本
    KERNEL_VERSION=$(uname -r | cut -d'.' -f1,2)
    echo "内核版本: $(uname -r)"
}

# 启动基础设施
start_infrastructure() {
    echo ""
    echo "🐳 启动基础设施容器..."

    # 检查 docker-compose.yml 是否存在
    if [ ! -f "docker-compose.yml" ]; then
        echo -e "${RED}✗${NC} docker-compose.yml 不存在，请确保在项目根目录运行此脚本"
        exit 1
    fi

    # 复制环境变量模板
    if [ ! -f ".env" ]; then
        echo "复制 .env.example 到 .env"
        cp .env.example .env
        echo -e "${YELLOW}⚠${NC} 请编辑 .env 文件配置必要的环境变量（数据库密码、AI API Key 等）"
    fi

    # 启动容器
    docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d

    echo "等待服务启动..."
    sleep 5

    # 检查服务状态
    docker compose ps

    echo ""
    echo "⏳ 等待 PostgreSQL 就绪..."
    until docker compose exec -T postgres pg_isready -U traceos &> /dev/null; do
        echo -n "."
        sleep 2
    done
    echo ""
    echo -e "${GREEN}✓${NC} PostgreSQL 已就绪"
}

# 生成 Proto 代码
generate_proto() {
    echo ""
    echo "🔧 生成 Proto 代码..."

    if [ -f "Makefile" ] && grep -q "gen-proto" Makefile; then
        make gen-proto
    elif [ -f "scripts/gen-proto.sh" ]; then
        bash scripts/gen-proto.sh
    else
        echo -e "${YELLOW}⚠${NC} 未找到 proto 生成脚本，请手动运行 make gen-proto"
    fi
}

# 主流程
main() {
    echo "=========================================="
    echo "  TraceOS Lab 开发环境初始化"
    echo "=========================================="
    echo ""

    # 检查并安装各组件
    check_docker
    check_command go || install_go
    check_command python3.11 || install_python_uv
    check_command node || install_node_pnpm
    install_go_tools
    check_command buf || install_buf
    check_nsjail
    check_system_tools

    # 启动基础设施
    start_infrastructure

    # 生成 Proto 代码
    generate_proto

    # 完成
    echo ""
    echo "=========================================="
    echo -e "${GREEN}✓ 开发环境初始化完成！${NC}"
    echo "=========================================="
    echo ""
    echo "启动应用服务："
    echo "  终端1: cd services/core-service && air"
    echo "  终端2: cd services/ai-service && uvicorn app.main:app --reload --port 8000"
    echo "  终端3: cd services/observability && air"
    echo "  终端4: cd frontend && pnpm dev"
    echo ""
    echo "访问："
    echo "  前端:    http://localhost:3000"
    echo "  Core API: http://localhost:8080"
    echo "  AI API:   http://localhost:8000/docs"
    echo "  MinIO:    http://localhost:9001"
    echo "  Grafana:  http://localhost:3001"
    echo ""
    echo "常用命令："
    echo "  make dev       # 启动开发环境"
    echo "  make dev-down  # 停止开发环境"
    echo "  make gen-proto # 生成 Proto 代码"
    echo "  make logs      # 查看服务日志"
    echo ""
}

# 运行主流程
main