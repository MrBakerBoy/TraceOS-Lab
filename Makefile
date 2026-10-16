.PHONY: deploy deploy-infra deploy-app deploy-monitor \
       dev dev-down prod prod-down \
       build down destroy status logs gen-proto \
       sandbox-base sandbox-process help

# =============================================================================
# TraceOS Lab Makefile
# =============================================================================
# 默认部署模式：全部启动 (基础设施 + 应用 + 监控)
# =============================================================================

# ─── 一键部署 ────────────────────────────────────────────────────────────────

deploy: ## 一键部署全部服务（推荐）
	@bash scripts/deploy.sh full

deploy-infra: ## 仅部署基础设施 (PG, Redis, MinIO, NATS)
	@bash scripts/deploy.sh infra

deploy-app: ## 部署基础设施 + 应用服务
	@bash scripts/deploy.sh app

deploy-monitor: ## 部署基础设施 + 监控栈
	@bash scripts/deploy.sh monitor

# ─── 直接 Docker Compose 命令 ────────────────────────────────────────────────

build: ## 构建所有镜像
	docker compose --profile app --profile monitoring build

up: ## 启动全部服务
	docker compose --profile app --profile monitoring up -d

down: ## 停止所有服务
	docker compose --profile app --profile monitoring down

destroy: ## 停止并删除所有数据卷
	docker compose --profile app --profile monitoring down -v

status: ## 查看服务状态
	@docker compose --profile app --profile monitoring ps

logs: ## 查看实时日志
	docker compose --profile app --profile monitoring logs -f

# ─── 兼容旧命令 ─────────────────────────────────────────────────────────────

dev: ## 开发模式 (= deploy-app)
	docker compose --profile app up -d

dev-down: ## 停止开发环境
	docker compose --profile app down

prod: ## 生产模式 (= deploy full)
	@bash scripts/deploy.sh full

prod-down: ## 停止生产环境
	docker compose --profile app --profile monitoring down

# ─── Proto 代码生成 ─────────────────────────────────────────────────────────

gen-proto: ## 生成 Proto 代码 (需要本地 Go/Python 工具链)
	@bash scripts/gen-proto.sh

# ─── 沙箱镜像构建 ────────────────────────────────────────────────────────────

sandbox-base: ## 构建基础实验镜像
	docker build -t traceos-lab/base:latest sandbox/lab-images/base/

sandbox-process: ## 构建进程实验镜像
	docker build -t traceos-lab/process-lab:latest sandbox/lab-images/process-lab/

sandbox: sandbox-base sandbox-process ## 构建所有沙箱镜像

# ─── 帮助 ────────────────────────────────────────────────────────────────────

help: ## 显示帮助信息
	@echo ""
	@echo "TraceOS Lab - 容器化部署"
	@echo "========================"
	@echo ""
	@echo "快速开始:"
	@echo "  make deploy          一键部署全部服务"
	@echo "  make deploy-infra    仅启动基础设施"
	@echo "  make deploy-app      基础设施 + 应用服务"
	@echo "  make down            停止所有服务"
	@echo ""
	@echo "所有命令:"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}'
	@echo ""

# 默认目标
.DEFAULT_GOAL := help
