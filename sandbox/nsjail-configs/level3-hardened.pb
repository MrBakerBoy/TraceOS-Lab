# nsjail 配置 - Level 3: 强化沙箱
# 用于内核相关实验，最强隔离，限制最多

name: "os-lab-level3"
description: "强化沙箱，适用于内核级实验，最强隔离"

mode: ONCE

hostname: "traceos-sandbox"
cwd: "/home/student"

# 时间限制
time_limit: 180

# cgroup 资源限制（非常严格）
cgroup_pids_max: 16
cgroup_cpu_ms_per_sec: 500  # 50% CPU
cgroup_mem_max: 67108864  # 64MB

# 能力控制 - 最小能力集
cap_drop_all: true
cap_keep: [
    "CAP_KILL",
    "CAP_SETUID",
    "CAP_SETGID"
]

# seccomp - 最小系统调用集
seccomp_string: [
    "ALLOW { write, read, openat, close, fstat, newfstatat, lseek, mmap, mprotect, munmap, brk,",
    "  rt_sigaction, rt_sigprocmask, ioctl, access, faccessat, faccessat2, pipe, pipe2,",
    "  poll, sched_yield, nanosleep, clock_nanosleep, getpid,",
    "  dup, dup2, fcntl, fsync, fdatasync, truncate, ftruncate,",
    "  getpid, getppid, getuid, geteuid, getgid, getegid, getresuid, getresgid,",
    "  sigaltstack, uname, getrlimit, getrusage, sysinfo, times, getcwd,",
    "  clone, clone3, fork, vfork, execve, exit, exit_group, wait4, waitid,",
    "  futex, set_robust_list, arch_prctl, set_tid_address,",
    "  clock_gettime, clock_getres, rseq }",
    "DEFAULT KILL"
]

# 命名空间隔离
clone_newnet: true
clone_newuser: true
clone_newns: true
clone_newpid: true
clone_newipc: true
clone_newuts: true
clone_newcgroup: true

# 挂载配置（最严格）
mount: [
    # proc 文件系统（只读，最小访问）
    {
        src: "proc",
        dst: "/proc",
        is_bind: false,
        fstype: "proc",
        options: "ro,nosuid,noexec,nodev",
        mandatory: true
    },
    # 只允许基本 proc 文件
    {
        src: "/proc/self/status",
        dst: "/proc/self/status",
        is_bind: true,
        rw: false,
        mandatory: false
    },
    # tmpfs（禁止执行）
    {
        src: "none",
        dst: "/tmp",
        is_bind: false,
        fstype: "tmpfs",
        options: "rw,noexec,nosuid,nodev,size=20M",
        mandatory: false
    },
    # 工作目录（只读，通过 overlayfs 实现）
    {
        src: "/home/student",
        dst: "/home/student",
        is_bind: true,
        rw: true,
        mandatory: false
    }
]

# 环境变量（最小化）
environ: [
    "PATH=/bin",
    "HOME=/home/student",
    "USER=student"
]

# UID/GID 映射
uidmap: [
    { inside_id: 0, outside_id: 1000, count: 1 },
    { inside_id: 1, outside_id: 100001, count: 65536 }
]

gidmap: [
    { inside_id: 0, outside_id: 1000, count: 1 },
    { inside_id: 1, outside_id: 100001, count: 65536 }
]

keep_root: false
stderr_to_stdout: false

# 额外安全选项
disable_no_new_privs: false