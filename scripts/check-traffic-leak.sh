#!/bin/bash
# check-traffic-leak.sh — 检查项目中是否存在公网流量泄露
# 在 docker build 之前运行此脚本

echo "=== 检查公网流量泄露 ==="
ERRORS=0

# 检查 Dockerfile 中的公网 pip 源
if grep -rn 'mirrors\.aliyun\.com/pypi' /root/traceos-lab/services/ --include='Dockerfile' -q 2>/dev/null; then
    echo "[FAIL] Dockerfile 中发现 mirrors.aliyun.com/pypi (公网!) → 改用 mirrors.cloud.aliyuncs.com/pypi"
    grep -rn 'mirrors\.aliyun\.com/pypi' /root/traceos-lab/services/ --include='Dockerfile'
    ERRORS=$((ERRORS+1))
fi

# 检查 download.pytorch.org
if grep -rn 'download\.pytorch\.org' /root/traceos-lab/ --include='Dockerfile' --include='*.yml' -q 2>/dev/null; then
    echo "[FAIL] 发现 download.pytorch.org (公网!) → 改用 mirrors.cloud.aliyuncs.com/pytorch-wheels/cpu/"
    grep -rn 'download\.pytorch\.org' /root/traceos-lab/ --include='Dockerfile' --include='*.yml'
    ERRORS=$((ERRORS+1))
fi

# 检查 Docker registry mirrors
if grep -q 'docker.1ms.run\|docker.xuanyuan.me\|hub-mirror.c.163.com\|mirror.baidubce.com\|docker.m.daocloud.io' /etc/docker/daemon.json 2>/dev/null; then
    echo "[FAIL] daemon.json 使用公网 registry mirror → 改用 registry-vpc.cn-hangzhou.aliyuncs.com"
    ERRORS=$((ERRORS+1))
fi

# 检查 Go proxy
if grep -rn 'GOPROXY=https://proxy.golang.org' /root/traceos-lab/services/ --include='Dockerfile' -q 2>/dev/null; then
    echo "[FAIL] GOPROXY 指向公网 → 改用 mirrors.cloud.aliyuncs.com/goproxy/"
    ERRORS=$((ERRORS+1))
fi

if [ $ERRORS -eq 0 ]; then
    echo "[PASS] 未发现公网流量泄露，可以安全构建！"
else
    echo ""
    echo "发现 $ERRORS 个公网流量泄露，请先修复再构建！"
    echo "修复命令:"
    echo "  find /root/traceos-lab -name 'Dockerfile' -exec sed -i 's|mirrors.aliyun.com|mirrors.cloud.aliyuncs.com|g' {} +"
    exit 1
fi

