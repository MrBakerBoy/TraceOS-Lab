# nsjail 配置 - Level 1: 标准沙箱
# 用于普通实验，基础隔离，性能优先

name: "os-lab-level1"
description: "标准沙箱，适用于基础实验"

mode: ONCE  # 执行一次后退出

hostname: "traceos-sandbox"
cwd: "/home/student"

# 时间限制 (秒)
time_limit: 300

# cgroup 资源限制
cgroup_pids_max: 64
cgroup_cpu_ms_per_sec: 1000  # 100% CPU (可调整)
cgroup_mem_max: 268435456  # 256MB

# 能力控制 - 保留基本能力
cap_drop_all: true
cap_keep: [
    "CAP_CHOWN",
    "CAP_DAC_OVERRIDE",
    "CAP_FOWNER",
    "CAP_FSETID",
    "CAP_KILL",
    "CAP_SETGID",
    "CAP_SETUID",
    "CAP_SETPCAP",
    "CAP_NET_BIND_SERVICE",
    "CAP_NET_RAW",
    "CAP_SYS_CHROOT",
    "CAP_MKNOD",
    "CAP_AUDIT_WRITE",
    "CAP_SETFCAP"
]

# seccomp - 允许常用系统调用
seccomp_string: [
    "ALLOW { write, read, openat, close, fstat, newfstatat, lseek, mmap, mprotect, munmap, brk,",
    "  rt_sigaction, rt_sigprocmask, ioctl, access, faccessat, faccessat2, pipe, pipe2,",
    "  select, poll, sched_yield, mremap, nanosleep, clock_nanosleep, alarm, getpid,",
    "  sendfile, dup, dup2, dup3, fcntl, flock, fsync, fdatasync, truncate, ftruncate,",
    "  getpid, getppid, getuid, geteuid, getgid, getegid, getresuid, getresgid,",
    "  sigaltstack, uname, getrlimit, getrusage, sysinfo, times, getgroups,",
    "  setgroups, gethostname, getdents64, setrlimit, getdents, getcwd,",
    "  socket, connect, bind, listen, accept, accept4, sendmsg, recvmsg,",
    "  shutdown, getsockname, getpeername, socketpair, setsockopt, getsockopt,",
    "  clone, clone3, fork, vfork, execve, exit, exit_group, wait4, waitid,",
    "  futex, set_robust_list, get_robust_list, splice, tee, readlinkat,",
    "  newfstatat, fstatfs, statfs, arch_prctl, set_tid_address,",
    "  clock_gettime, clock_getres, rseq, getrandom, gettimeofday, time }",
    "DEFAULT KILL"
]

# 命名空间隔离
clone_newnet: true   # 独立网络命名空间
clone_newuser: true  # 用户命名空间
clone_newns: true    # 挂载命名空间
clone_newpid: true   # PID 命名空间
clone_newipc: true   # IPC 命名空间
clone_newuts: true   # UTS 命名空间
clone_newcgroup: true # Cgroup 命名空间

# 挂载配置
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
    # tmpfs (临时文件系统)
    {
        src: "none",
        dst: "/tmp",
        is_bind: false,
        fstype: "tmpfs",
        options: "rw,size=100M",
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

# 环境变量
environ: [
    "PATH=/usr/local/bin:/usr/bin:/bin",
    "TERM=xterm",
    "HOME=/home/student",
    "USER=student",
    "LANG=C.UTF-8",
    "LC_ALL=C.UTF-8"
]

# UID/GID 映射
uidmap: [
    { inside_id: 0, outside_id: 1000, count: 1 },  # root 映射到外部的 student 用户
    { inside_id: 1, outside_id: 100001, count: 65536 }  # 其他用户
]

gidmap: [
    { inside_id: 0, outside_id: 1000, count: 1 },
    { inside_id: 1, outside_id: 100001, count: 65536 }
]

# 保持根目录
keep_root: false

# 重定向 stderr
stderr_to_stdout: false

# 绑定端口（如果需要）
# bindport: 8080