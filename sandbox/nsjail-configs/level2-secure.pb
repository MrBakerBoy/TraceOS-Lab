# nsjail 配置 - Level 2: 安全沙箱
# 用于安全敏感实验，强化隔离，观测优先

name: "os-lab-level2"
description: "安全沙箱，适用于涉及文件描述符、进程管理等实验"

mode: ONCE

hostname: "traceos-sandbox"
cwd: "/home/student"

# 时间限制
time_limit: 300

# cgroup 资源限制（更严格）
cgroup_pids_max: 32
cgroup_cpu_ms_per_sec: 800  # 80% CPU
cgroup_mem_max: 134217728  # 128MB

# 能力控制 - 只保留必需能力
cap_drop_all: true
cap_keep: [
    "CAP_DAC_OVERRIDE",
    "CAP_FOWNER",
    "CAP_KILL",
    "CAP_SETGID",
    "CAP_SETUID",
    "CAP_SETPCAP"
]

# seccomp - 更严格的白名单
seccomp_string: [
    "ALLOW { write, read, openat, close, fstat, newfstatat, lseek, mmap, mprotect, munmap, brk,",
    "  rt_sigaction, rt_sigprocmask, ioctl, access, faccessat, faccessat2, pipe, pipe2,",
    "  select, poll, sched_yield, nanosleep, clock_nanosleep, getpid,",
    "  dup, dup2, dup3, fcntl, flock, fsync, fdatasync, truncate, ftruncate,",
    "  getpid, getppid, getuid, geteuid, getgid, getegid, getresuid, getresgid,",
    "  sigaltstack, uname, getrlimit, getrusage, sysinfo, times, getgroups,",
    "  setgroups, gethostname, getcwd,",
    "  socket, connect, bind, listen, accept, accept4, setsockopt, getsockopt,",
    "  clone, clone3, fork, vfork, execve, exit, exit_group, wait4, waitid,",
    "  futex, set_robust_list, get_robust_list, readlinkat,",
    "  newfstatat, fstatfs, statfs, arch_prctl, set_tid_address,",
    "  clock_gettime, clock_getres, rseq, getrandom }",
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

# 挂载配置（更严格）
mount: [
    # proc 文件系统（只读，限制访问）
    {
        src: "proc",
        dst: "/proc",
        is_bind: false,
        fstype: "proc",
        options: "ro,nosuid,noexec,nodev",
        mandatory: true
    },
    # 只允许部分 proc 文件可读
    {
        src: "/proc/self/status",
        dst: "/proc/self/status",
        is_bind: true,
        rw: false,
        mandatory: false
    },
    # tmpfs
    {
        src: "none",
        dst: "/tmp",
        is_bind: false,
        fstype: "tmpfs",
        options: "rw,noexec,nosuid,size=50M",
        mandatory: false
    },
    # 工作目录
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
    "PATH=/usr/bin:/bin",
    "TERM=xterm",
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