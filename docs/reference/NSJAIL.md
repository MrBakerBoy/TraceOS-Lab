# TraceOS Lab nsjail 沙箱配置详解

本文档详细说明 TraceOS Lab 中 nsjail 沙箱的配置和使用。

---

## 📋 目录

- [nsjail 简介](#nsjail-简介)
- [分级沙箱策略](#分级沙箱策略)
- [配置文件详解](#配置文件详解)
- [使用示例](#使用示例)
- [故障排查](#故障排查)

---

## nsjail 简介

nsjail 是 Google 开源的轻量级沙箱工具，提供以下特性：

- **Namespace 隔离**: PID、NET、MNT、USER、IPC、UTS、CGROUP
- **cgroups 资源限制**: CPU、内存、PID 数量
- **seccomp 系统调用过滤**: 白名单模式
- **Capability 裁剪**: 最小权限原则
- **进程隔离**: 每个沙箱独立进程树

**优势**：

- ✅ 性能开销小
- ✅ 配置灵活
- ✅ 生产级可用（Google CTF 基础设施）

---

## 分级沙箱策略

```
Level 1 普通实验     → runc + 基础 seccomp (标准隔离，性能优先)
Level 2 安全敏感实验 → nsjail + 严格 seccomp 白名单 + capability 裁剪 (强隔离，观测优先)
Level 3 内核相关实验 → nsjail + 完整命名空间隔离 + cgroup 严格限制 + /proc /sys 只读挂载 (最强隔离)
```

### Level 1: 标准沙箱

**适用场景**：
- 基础进程管理实验
- 简单文件 I/O 实验
- 入门级实验

**特性**：
- 完整的 namespace 隔离
- 基础 seccomp 白名单（~100 个 syscall）
- 完整的 capability 集合
- 256MB 内存限制
- 300 秒时间限制

**配置文件**: `sandbox/nsjail-configs/level1-standard.pb`

### Level 2: 安全沙箱

**适用场景**：
- 线程同步实验
- 内存管理实验
- 文件描述符管理实验

**特性**：
- 完整的 namespace 隔离
- 严格 seccomp 白名单（~60 个 syscall）
- 最小 capability 集合（6 个）
- 128MB 内存限制
- 300 秒时间限制
- `/proc` 只读挂载

**配置文件**: `sandbox/nsjail-configs/level2-secure.pb`

### Level 3: 强化沙箱

**适用场景**：
- 调度器实验
- 死锁检测实验
- 内核级实验

**特性**：
- 完整的 namespace 隔离
- 最小 seccomp 白名单（~40 个 syscall）
- 最小 capability 集合（3 个）
- 64MB 内存限制
- 180 秒时间限制
- `/proc` 最小访问（只允许部分文件）
- 禁止网络操作

**配置文件**: `sandbox/nsjail-configs/level3-hardened.pb`

---

## 配置文件详解

### 基本配置

```protobuf
name: "os-lab-level1"         # 沙箱名称
description: "标准沙箱"        # 描述信息
mode: ONES                     # 执行模式：ONCE（单次）、RELISTEN（持续）
hostname: "traceos-sandbox"    # 主机名
cwd: "/home/student"           # 工作目录
```

### 资源限制

```protobuf
# 时间限制（秒）
time_limit: 300

# cgroup 限制
cgroup_pids_max: 64                    # 最大进程数
cgroup_cpu_ms_per_sec: 800             # CPU 限制（80%）
cgroup_mem_max: 268435456              # 内存限制（256MB）
```

### Capability 裁剪

```protobuf
# 先删除所有 capability
cap_drop_all: true

# 只保留必要的
cap_keep: [
    "CAP_CHOWN",        # 修改文件所有者
    "CAP_DAC_OVERRIDE", # 绕过文件权限检查
    "CAP_FOWNER",       # 修改自己拥有的文件
    "CAP_KILL",         # 发送信号
    "CAP_SETGID",       # 设置组 ID
    "CAP_SETUID",       # 设置用户 ID
    "CAP_SETPCAP"       # 修改进程 capability
]
```

### seccomp 系统调用过滤

```protobuf
seccomp_string: [
    "ALLOW { write, read, openat, close, fstat, mmap, mprotect, munmap, brk,",
    "  clone, fork, execve, exit, exit_group, wait4, futex }",
    "DEFAULT KILL"
]
```

**注意**：
- `ALLOW` 指定允许的系统调用
- `DEFAULT KILL` 拒绝所有其他系统调用
- 系统调用名用逗号分隔

### 命名空间隔离

```protobuf
clone_newnet: true    # 网络命名空间（隔离网络栈）
clone_newuser: true   # 用户命名空间（UID/GID 隔离）
clone_newns: true     # 挂载命名空间（隔离文件系统）
clone_newpid: true    # PID 命名空间（隔离进程树）
clone_newipc: true    # IPC 命名空间（隔离 IPC 对象）
clone_newuts: true    # UTS 命名空间（隔离主机名）
clone_newcgroup: true # Cgroup 命名空间（隔离资源控制）
```

### 挂载配置

```protobuf
mount: [
    # proc 文件系统（只读）
    {
        src: "proc",
        dst: "/proc",
        is_bind: false,
        fstype: "proc",
        options: "ro",
        mandatory: true
    },
    # tmpfs（临时文件系统）
    {
        src: "none",
        dst: "/tmp",
        is_bind: false,
        fstype: "tmpfs",
        options: "rw,size=100M",
        mandatory: false
    },
    # 挂载工作目录
    {
        src: "/home/student",
        dst: "/home/student",
        is_bind: true,
        rw: true,
        mandatory: false
    }
]
```

### UID/GID 映射

```protobuf
uidmap: [
    { inside_id: 0, outside_id: 1000, count: 1 },  # root 映射到外部 student 用户
    { inside_id: 1, outside_id: 100001, count: 65536 }  # 其他用户映射到子 UID 命名空间
]

gidmap: [
    { inside_id: 0, outside_id: 1000, count: 1 },
    { inside_id: 1, outside_id: 100001, count: 65536 }
]
```

---

## 使用示例

### 1. 基础使用

```bash
# 使用配置文件启动沙箱
nsjail \
    --config /path/to/config.pb \
    -- /bin/bash

# 执行单个命令
nsjail \
    --config /path/to/config.pb \
    -- /bin/echo "Hello from sandbox!"
```

### 2. 容器内使用

```bash
# 在 Docker 容器中使用（需要特权）
docker run \
    --privileged \
    -v /tmp:/tmp \
    -v /var/run/docker.sock:/var/run/docker.sock \
    traceos-lab/observability:latest \
    nsjail --config /config/level1-standard.pb -- /bin/bash
```

### 3. Go 代码调用

```go
package main

import (
    "fmt"
    "os/exec"
)

func RunInSandbox(configPath, command string, args ...string) error {
    cmd := exec.Command("nsjail",
        "--config", configPath,
        "--", command)
    cmd.Args = append(cmd.Args, args...)

    output, err := cmd.CombinedOutput()
    if err != nil {
        return fmt.Errorf("nsjail error: %w\nOutput: %s", err, output)
    }

    fmt.Println(string(output))
    return nil
}
```

---

## 故障排查

### 问题 1: nsjail 权限不足

**错误信息**:
```
nsjail: jailer.c:672: clone3: Operation not permitted
```

**解决方案**:

1. 确保 nsjail 以 root 权限运行
2. 或赋予必要的 capability:

```bash
sudo setcap cap_sys_admin+ep /usr/local/bin/nsjail
```

3. 在 Docker 中使用 `privileged: true`:

```yaml
observability:
  privileged: true
```

### 问题 2: seccomp 规则过于严格

**错误信息**:
```
nsjail: seccomp: Bad system call
```

**解决方案**:

1. 检查缺失的系统调用
2. 在配置文件中添加允许的系统调用
3. 使用 `strace` 观察程序调用的系统调用

```bash
strace -e trace=clone,fork,execve,open,write ./your_program
```

### 问题 3: 内存不足

**错误信息**:
```
nsjail: cgroup: Memory limit exceeded
```

**解决方案**:

1. 增加内存限制

```protobuf
cgroup_mem_max: 536870912  # 512MB
```

2. 或使用 Level 1 沙箱

### 问题 4: /proc 访问受限

**症状**: 程序无法读取 `/proc/self/status` 等文件

**解决方案**:

1. 确保正确挂载 proc 文件系统
2. 检查挂载选项

```protobuf
mount: [
    {
        src: "proc",
        dst: "/proc",
        is_bind: false,
        fstype: "proc",
        options: "ro",
        mandatory: true
    }
]
```

---

## 最佳实践

1. **最小权限原则**: 只允许必要的系统调用和 capability
2. **资源限制**: 设置合理的内存和时间限制，防止资源耗尽
3. **只读挂载**: 尽可能使用只读挂载，防止意外修改
4. **日志记录**: 记录沙箱执行日志，便于故障排查
5. **定期更新**: 及时更新 nsjail 和相关工具

---

**文档版本**: 1.0
**最后更新**: 2024-06-02