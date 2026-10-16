#!/bin/bash

# TraceOS Lab Proto 代码生成脚本

set -e

echo "🔧 生成 Proto 代码..."
echo ""

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 项目根目录
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROTO_DIR="${PROJECT_ROOT}/proto"

# 检查 protoc 是否安装
if ! command -v protoc &> /dev/null; then
    echo -e "${RED}✗${NC} protoc 未安装"
    echo "请运行: sudo apt-get install -y protobuf-compiler"
    exit 1
fi
echo -e "${GREEN}✓${NC} protoc: $(protoc --version)"

# 检查 Go 插件
GO_PLUGINS=("protoc-gen-go" "protoc-gen-go-grpc" "protoc-gen-openapiv2")
for plugin in "${GO_PLUGINS[@]}"; do
    if ! command -v $plugin &> /dev/null; then
        echo -e "${YELLOW}⚠${NC} $plugin 未安装，正在安装..."
        go install google.golang.org/protobuf/cmd/protoc-gen-go@latest
        go install google.golang.org/grpc/cmd/protoc-gen-go-grpc@latest
        go install github.com/grpc-ecosystem/grpc-gateway/v2/protoc-gen-openapiv2@latest
        break
    fi
done

# 检查 Python 插件
if ! command -v grpc_python_plugin &> /dev/null; then
    echo -e "${YELLOW}⚠${NC} grpc_python_plugin 未安装"
    echo "请运行: pip install grpcio-tools"
fi

# 创建输出目录
mkdir -p "${PROJECT_ROOT}/services/core-service/pkg/gen"
mkdir -p "${PROJECT_ROOT}/services/observability/pkg/gen"
mkdir -p "${PROJECT_ROOT}/services/ai-service/pkg/gen"
mkdir -p "${PROJECT_ROOT}/services/core-service/api/docs"

# 生成 Go 代码
echo ""
echo "📦 生成 Go 代码 (core-service)..."
cd "${PROTO_DIR}"

for pkg in core ai; do
    if [ -d "${pkg}/v1" ]; then
        echo "  处理 ${pkg}/v1/*.proto..."
        protoc \
            --proto_path=. \
            --proto_path=third_party/googleapis \
            --go_out=../services/${pkg}-service/pkg/gen \
            --go_opt=paths=source_relative \
            --go_opt=module=github.com/xxx/TraceOS-Lab/services/${pkg}-service \
            --go-grpc_out=../services/${pkg}-service/pkg/gen \
            --go-grpc_opt=paths=source_relative \
            --go-grpc_opt=module=github.com/xxx/TraceOS-Lab/services/${pkg}-service \
            $(find ${pkg}/v1 -name "*.proto")
    fi
done

# 生成 Observability Go 代码
echo ""
echo "📦 生成 Go 代码 (observability)..."
protoc \
    --proto_path=. \
    --proto_path=third_party/googleapis \
    --go_out=../services/observability/pkg/gen \
    --go_opt=paths=source_relative \
    --go_opt=module=github.com/xxx/TraceOS-Lab/services/observability \
    --go-grpc_out=../services/observability/pkg/gen \
    --go-grpc_opt=paths=source_relative \
    --go-grpc_opt=module=github.com/xxx/TraceOS-Lab/services/observability \
    $(find observability/v1 -name "*.proto")

# 生成 gRPC Gateway 代码 (REST API 转换)
echo ""
echo "📦 生成 gRPC Gateway 代码..."
protoc \
    --proto_path=. \
    --proto_path=third_party/googleapis \
    --grpc-gateway_out=../services/core-service/pkg/gen \
    --grpc-gateway_opt=paths=source_relative \
    --grpc-gateway_opt=module=github.com/xxx/TraceOS-Lab/services/core-service \
    --grpc-gateway_opt=generate_unbound_methods=true \
    $(find core/v1 -name "*.proto")

# 生成 OpenAPI 文档
echo ""
echo "📦 生成 OpenAPI 文档..."
protoc \
    --proto_path=. \
    --proto_path=third_party/googleapis \
    --openapiv2_out=../services/core-service/api/docs \
    --openapiv2_opt=logtostderr=true \
    --openapiv2_opt=json_names_for_fields=false \
    --openapiv2_opt=allow_merge=true \
    --openapiv2_opt=merge_file_name=api \
    $(find core/v1 -name "*.proto")

# 生成 Python 代码
echo ""
echo "📦 生成 Python 代码 (ai-service)..."
if command -v grpc_python_plugin &> /dev/null; then
    for pkg in ai; do
        if [ -d "${pkg}/v1" ]; then
            echo "  处理 ${pkg}/v1/*.proto..."
            python3 -m grpc_tools.protoc \
                --proto_path=. \
                --proto_path=third_party/googleapis \
                --python_out=../services/${pkg}-service/pkg/gen \
                --python_opt=paths=source_relative \
                --grpc_python_out=../services/${pkg}-service/pkg/gen \
                --grpc_python_opt=paths=source_relative \
                $(find ${pkg}/v1 -name "*.proto")
        fi
    done
else
    echo -e "${YELLOW}⚠${NC} 跳过 Python 代码生成（grpc_python_plugin 未安装）"
fi

# 创建 __init__.py 文件
echo ""
echo "📦 创建 Python 包文件..."
touch "${PROJECT_ROOT}/services/ai-service/pkg/gen/__init__.py"

# 完成
echo ""
echo "=========================================="
echo -e "${GREEN}✓ Proto 代码生成完成！${NC}"
echo "=========================================="
echo ""
echo "生成的文件："
echo "  Go (core-service):"
echo "    - services/core-service/pkg/gen/core/v1/*.pb.go"
echo "    - services/core-service/pkg/gen/core/v1/*.gw.go"
echo "  Go (observability):"
echo "    - services/observability/pkg/gen/observability/v1/*.pb.go"
echo "  Python (ai-service):"
echo "    - services/ai-service/pkg/gen/ai/v1/*_pb2.py"
echo "  OpenAPI 文档:"
echo "    - services/core-service/api/docs/api.swagger.json"
echo ""