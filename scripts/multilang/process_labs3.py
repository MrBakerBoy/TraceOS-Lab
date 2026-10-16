#!/usr/bin/env python3
import subprocess

def get_exp_id(name):
    sql = f"SELECT id FROM experiments WHERE name='{name}'"
    r = subprocess.run(['docker','exec','-i','traceos-postgres','psql','-U','traceos','-d','traceos','-t','-A','-c',sql], capture_output=True, text=True)
    return r.stdout.strip()

def esc(s):
    if s is None: return 'NULL'
    return "'" + s.replace("'", "''") + "'"

def upsert(exp_name, lang, starter, reference):
    exp_id = get_exp_id(exp_name)
    if not exp_id: print(f'  SKIP {exp_name}'); return
    sql = f"""INSERT INTO experiment_code_templates (experiment_id, language, starter_code, reference_solution, is_published, updated_at)
VALUES ('{exp_id}', '{lang}', {esc(starter)}, {esc(reference)}, true, NOW())
ON CONFLICT (experiment_id, language) DO UPDATE SET starter_code=EXCLUDED.starter_code, reference_solution=EXCLUDED.reference_solution, updated_at=NOW();"""
    r = subprocess.run(['docker','exec','-i','traceos-postgres','psql','-U','traceos','-d','traceos','-c',sql], capture_output=True, text=True)
    print(f'  {"OK" if r.returncode==0 else "ERROR"} {exp_name}/{lang}')

# ==================== lab5_signal_handler ====================
upsert('lab5_signal_handler', 'cpp', r'''#include <cstdio>
#include <csignal>
#include <unistd.h>
#include <cstdlib>

/**
 * 信号处理实验：捕获 SIGINT 和 SIGUSR1
 * 目标：注册信号处理器，理解信号的异步通信机制
 * 提示：
 *   - signal(SIGINT, handler) 注册信号处理器（注意：不同平台上语义有差异）
 *   - 推荐使用 sigaction() 进行更可靠的信号处理
 *   - 全局变量在信号处理器中使用应声明为 volatile sig_atomic_t
 *   - 主循环使用 pause() 等待信号，或使用 sigsuspend()
 */
volatile sig_atomic_t sigint_count = 0;
volatile sig_atomic_t sigusr1_count = 0;

void sigint_handler(int sig) {
    /* ==== CODE START ==== */
    // TODO: 递增 sigint_count，输出 "SIGINT received"

    // TODO: 当 sigint_count 达到3时退出程序

    /* ==== CODE END ==== */
}

void sigusr1_handler(int sig) {
    /* ==== CODE START ==== */
    // TODO: 递增 sigusr1_count，输出 "SIGUSR1 received count=N"

    /* ==== CODE END ==== */
}

int main() {
    /* ==== CODE START ==== */
    // TODO: 注册 SIGINT 和 SIGUSR1 的处理器

    // TODO: 循环调用 pause() 等待信号

    /* ==== CODE END ==== */
    return 0;
}
''', r'''#include <cstdio>
#include <csignal>
#include <unistd.h>
#include <cstdlib>

volatile sig_atomic_t sigint_count = 0;
volatile sig_atomic_t sigusr1_count = 0;

void sigint_handler(int sig) {
    /* ==== CODE START ==== */
    sigint_count++;
    printf("SIGINT received (%d/3)\n", sigint_count);
    if (sigint_count >= 3) {
        printf("Exiting after 3 SIGINTs\n");
        exit(0);
    }
    /* ==== CODE END ==== */
}

void sigusr1_handler(int sig) {
    /* ==== CODE START ==== */
    sigusr1_count++;
    printf("SIGUSR1 received count=%d\n", sigusr1_count);
    /* ==== CODE END ==== */
}

int main() {
    /* ==== CODE START ==== */
    signal(SIGINT, sigint_handler);
    signal(SIGUSR1, sigusr1_handler);

    printf("PID=%d, send SIGINT 3 times to exit\n", getpid());
    while (1) {
        pause();
    }
    /* ==== CODE END ==== */
    return 0;
}
''')

upsert('lab5_signal_handler', 'python', r'''#!/usr/bin/env python3
"""
信号处理实验：捕获 SIGINT 和 SIGUSR1
目标：注册信号处理器，理解信号的异步通信机制
提示：
  - signal.signal(signal.SIGINT, handler) 注册信号处理器
  - 全局变量在信号处理器中使用需注意线程安全
  - 主循环使用 signal.pause() 等待信号
"""
import signal
import os
import sys

sigint_count = 0
sigusr1_count = 0

def sigint_handler(sig, frame):
    # ==== CODE START ====
    # TODO: 递增 sigint_count，输出 "SIGINT received (N/3)"

    # TODO: 当 sigint_count 达到3时输出 "Exiting after 3 SIGINTs" 并退出

    # ==== CODE END ====
    pass

def sigusr1_handler(sig, frame):
    # ==== CODE START ====
    # TODO: 递增 sigusr1_count，输出 "SIGUSR1 received count=N"

    # ==== CODE END ====
    pass

# ==== CODE START ====
# TODO: 注册 SIGINT 和 SIGUSR1 的处理器

# TODO: 输出 "PID=N, send SIGINT 3 times to exit"

# TODO: 循环调用 signal.pause() 等待信号

# ==== CODE END ====
''', r'''#!/usr/bin/env python3
import signal
import os
import sys

sigint_count = 0
sigusr1_count = 0

def sigint_handler(sig, frame):
    global sigint_count
    sigint_count += 1
    print("SIGINT received (%d/3)" % sigint_count)
    if sigint_count >= 3:
        print("Exiting after 3 SIGINTs")
        sys.exit(0)

def sigusr1_handler(sig, frame):
    global sigusr1_count
    sigusr1_count += 1
    print("SIGUSR1 received count=%d" % sigusr1_count)

signal.signal(signal.SIGINT, sigint_handler)
signal.signal(signal.SIGUSR1, sigusr1_handler)

print("PID=%d, send SIGINT 3 times to exit" % os.getpid())
while True:
    signal.pause()
''')

upsert('lab5_signal_handler', 'go', r'''package main

/*
 * 信号处理实验：捕获 SIGINT 和 SIGUSR1
 * 目标：注册信号处理器，理解信号的异步通信机制
 * 提示：
 *   - Go 中使用 os/signal 包的 signal.Notify(channel, signals...) 注册信号
 *   - 通过 channel 接收信号，在主循环中处理
 *   - Go 的信号处理是 channel-based，比 C 的回调方式更安全
 */
import (
    "fmt"
    "os"
    "os/signal"
    "syscall"
)

var sigintCount int
var sigusr1Count int

func main() {
    /* ==== CODE START ==== */
    // TODO: 创建 signal channel 并注册 SIGINT 和 SIGUSR1

    // TODO: 输出 "PID=N, send SIGINT 3 times to exit"

    // TODO: 循环接收信号，SIGINT 计数到3退出，SIGUSR1 输出计数

    /* ==== CODE END ==== */
}
''', r'''package main

import (
    "fmt"
    "os"
    "os/signal"
    "syscall"
)

var sigintCount int
var sigusr1Count int

func main() {
    /* ==== CODE START ==== */
    sigs := make(chan os.Signal, 1)
    signal.Notify(sigs, syscall.SIGINT, syscall.SIGUSR1)

    fmt.Printf("PID=%d, send SIGINT 3 times to exit\n", os.Getpid())

    for {
        sig := <-sigs
        switch sig {
        case syscall.SIGINT:
            sigintCount++
            fmt.Printf("SIGINT received (%d/3)\n", sigintCount)
            if sigintCount >= 3 {
                fmt.Println("Exiting after 3 SIGINTs")
                os.Exit(0)
            }
        case syscall.SIGUSR1:
            sigusr1Count++
            fmt.Printf("SIGUSR1 received count=%d\n", sigusr1Count)
        }
    }
    /* ==== CODE END ==== */
}
''')

upsert('lab5_signal_handler', 'rust', r'''use std::os::raw::c_int;

/*
 * 信号处理实验：捕获 SIGINT 和 SIGUSR1
 * 目标：注册信号处理器，理解信号的异步通信机制
 * 提示：
 *   - Rust 中通过 extern "C" 调用 signal() 和 pause()
 *   - 信号处理器中只设置标志位，主循环中做打印（避免 async-signal-safety 问题）
 *   - SIGINT=2, SIGUSR1=10 (Linux x86_64)
 */
extern "C" {
    fn signal(signum: c_int, handler: extern "C" fn(c_int)) -> usize;
    fn pause() -> c_int;
    fn getpid() -> c_int;
}

static mut GOT_SIGINT: bool = false;
static mut GOT_SIGUSR1: bool = false;
static mut SIGINT_COUNT: c_int = 0;
static mut SIGUSR1_COUNT: c_int = 0;

extern "C" fn sigint_handler(_sig: c_int) {
    unsafe {
        SIGINT_COUNT += 1;
        GOT_SIGINT = true;
    }
}

extern "C" fn sigusr1_handler(_sig: c_int) {
    unsafe {
        SIGUSR1_COUNT += 1;
        GOT_SIGUSR1 = true;
    }
}

fn main() {
    /* ==== CODE START ==== */
    // TODO: 注册 SIGINT(2) 和 SIGUSR1(10) 的处理器

    // TODO: 输出 "PID=N, send SIGINT 3 times to exit"

    // TODO: 循环调用 pause()，检查标志位并打印

    /* ==== CODE END ==== */
}
''', r'''use std::os::raw::c_int;

extern "C" {
    fn signal(signum: c_int, handler: extern "C" fn(c_int)) -> usize;
    fn pause() -> c_int;
    fn getpid() -> c_int;
}

static mut GOT_SIGINT: bool = false;
static mut GOT_SIGUSR1: bool = false;
static mut SIGINT_COUNT: c_int = 0;
static mut SIGUSR1_COUNT: c_int = 0;

extern "C" fn sigint_handler(_sig: c_int) {
    unsafe { SIGINT_COUNT += 1; GOT_SIGINT = true; }
}

extern "C" fn sigusr1_handler(_sig: c_int) {
    unsafe { SIGUSR1_COUNT += 1; GOT_SIGUSR1 = true; }
}

fn main() {
    /* ==== CODE START ==== */
    unsafe {
        signal(2, sigint_handler);   // SIGINT
        signal(10, sigusr1_handler); // SIGUSR1

        println!("PID={}, send SIGINT 3 times to exit", getpid());

        loop {
            pause();
            if GOT_SIGINT {
                GOT_SIGINT = false;
                println!("SIGINT received ({}/3)", SIGINT_COUNT);
                if SIGINT_COUNT >= 3 {
                    println!("Exiting after 3 SIGINTs");
                    std::process::exit(0);
                }
            }
            if GOT_SIGUSR1 {
                GOT_SIGUSR1 = false;
                println!("SIGUSR1 received count={}", SIGUSR1_COUNT);
            }
        }
    }
    /* ==== CODE END ==== */
}
''')

# ==================== lab6_zombie_orphan ====================
upsert('lab6_zombie_orphan', 'cpp', r'''#include <cstdio>
#include <unistd.h>
#include <sys/wait.h>
#include <cstdlib>

/**
 * 僵尸进程与孤儿进程实验
 * 目标：演示僵尸进程产生及wait回收，孤儿进程被init收养
 * 提示：
 *   - 子进程先于父进程结束且未wait → 僵尸进程
 *   - 父进程先于子进程结束 → 子进程成为孤儿，被init(PID=1)收养
 *   - 僵尸进程用 waitpid 回收
 *   - 孤儿进程的PPID会变为1（容器中可能不是1但是当前会话leader）
 */
int main() {
    /* ==== CODE START ==== */
    // 场景1：僵尸进程
    // TODO: fork子进程，子进程立即exit(0)

    // TODO: 父进程sleep(1)后用waitpid回收，输出 "Zombie reaped: PID=xxx"

    // 场景2：孤儿进程
    // TODO: fork子进程，父进程exit(0)

    // TODO: 子进程sleep(2)后输出 "My PID=xxx, new PPID=yyy"

    /* ==== CODE END ==== */
    return 0;
}
''', r'''#include <cstdio>
#include <unistd.h>
#include <sys/wait.h>
#include <cstdlib>

int main() {
    /* ==== CODE START ==== */
    // 场景1：僵尸进程演示
    pid_t pid1 = fork();
    if (pid1 == 0) {
        _exit(0);
    } else {
        sleep(1);
        int status;
        pid_t reaped = waitpid(pid1, &status, 0);
        printf("Zombie reaped: PID=%d\n", reaped);
    }

    // 场景2：孤儿进程演示
    pid_t pid2 = fork();
    if (pid2 == 0) {
        sleep(2);
        printf("My PID=%d, new PPID=%d\n", getpid(), getppid());
        _exit(0);
    } else {
        _exit(0);
    }
    /* ==== CODE END ==== */
    return 0;
}
''')

upsert('lab6_zombie_orphan', 'python', r'''#!/usr/bin/env python3
"""
僵尸进程与孤儿进程实验
目标：演示僵尸进程产生及wait回收，孤儿进程被init收养
提示：
  - 子进程先于父进程结束且未wait → 僵尸进程
  - 父进程先于子进程结束 → 子进程成为孤儿，被init收养
  - 僵尸进程用 os.waitpid 回收
"""
import os
import time

# ==== CODE START ====
# 场景1：僵尸进程
# TODO: os.fork() 子进程，子进程立即 os._exit(0)

# TODO: 父进程 time.sleep(1) 后用 os.waitpid 回收，输出 "Zombie reaped: PID=xxx"

# 场景2：孤儿进程
# TODO: os.fork() 子进程，父进程 os._exit(0)

# TODO: 子进程 time.sleep(2) 后输出 "My PID=xxx, new PPID=yyy"

# ==== CODE END ====
''', r'''#!/usr/bin/env python3
import os
import time

# 场景1：僵尸进程演示
pid1 = os.fork()
if pid1 == 0:
    os._exit(0)
else:
    time.sleep(1)
    reaped, status = os.waitpid(pid1, 0)
    print("Zombie reaped: PID=%d" % reaped)

# 场景2：孤儿进程演示
pid2 = os.fork()
if pid2 == 0:
    time.sleep(2)
    print("My PID=%d, new PPID=%d" % (os.getpid(), os.getppid()))
    os._exit(0)
else:
    os._exit(0)
''')

upsert('lab6_zombie_orphan', 'go', r'''package main

/*
 * 僵尸进程与孤儿进程实验
 * 目标：演示僵尸进程产生及wait回收，孤儿进程被init收养
 * 提示：
 *   - 子进程先于父进程结束且未wait → 僵尸进程
 *   - 父进程先于子进程结束 → 子进程成为孤儿
 *   - 僵尸进程用 syscall.Wait4 回收
 */
import (
    "fmt"
    "os"
    "syscall"
    "time"
)

func main() {
    /* ==== CODE START ==== */
    // 场景1：僵尸进程
    // TODO: fork子进程，子进程立即 os.Exit(0)

    // TODO: 父进程 time.Sleep(1s) 后用 Wait4 回收，输出 "Zombie reaped: PID=xxx"

    // 场景2：孤儿进程
    // TODO: fork子进程，父进程 os.Exit(0)

    // TODO: 子进程 time.Sleep(2s) 后输出 "My PID=xxx, new PPID=yyy"

    /* ==== CODE END ==== */
}
''', r'''package main

import (
    "fmt"
    "os"
    "syscall"
    "time"
)

func main() {
    /* ==== CODE START ==== */
    // 场景1：僵尸进程演示
    pid1, _, _ := syscall.Syscall(syscall.SYS_FORK, 0, 0, 0)
    if pid1 == 0 {
        os.Exit(0)
    } else {
        time.Sleep(1 * time.Second)
        var status syscall.WaitStatus
        reaped, _ := syscall.Wait4(int(pid1), &status, 0, nil)
        fmt.Printf("Zombie reaped: PID=%d\n", reaped)
    }

    // 场景2：孤儿进程演示
    pid2, _, _ := syscall.Syscall(syscall.SYS_FORK, 0, 0, 0)
    if pid2 == 0 {
        time.Sleep(2 * time.Second)
        fmt.Printf("My PID=%d, new PPID=%d\n", os.Getpid(), os.Getppid())
        os.Exit(0)
    } else {
        os.Exit(0)
    }
    /* ==== CODE END ==== */
}
''')

upsert('lab6_zombie_orphan', 'rust', r'''use std::os::raw::c_int;

/*
 * 僵尸进程与孤儿进程实验
 * 目标：演示僵尸进程产生及wait回收，孤儿进程被init收养
 * 提示：
 *   - 子进程先于父进程结束且未wait → 僵尸进程
 *   - 父进程先于子进程结束 → 子进程成为孤儿
 */
extern "C" {
    fn fork() -> c_int;
    fn getpid() -> c_int;
    fn getppid() -> c_int;
    fn waitpid(pid: c_int, status: *mut c_int, options: c_int) -> c_int;
    fn sleep(secs: c_int) -> c_int;
    fn _exit(code: c_int) -> !;
}

fn main() {
    /* ==== CODE START ==== */
    // 场景1：僵尸进程
    // TODO: fork子进程，子进程立即 _exit(0)

    // TODO: 父进程 sleep(1) 后用 waitpid 回收，输出 "Zombie reaped: PID=xxx"

    // 场景2：孤儿进程
    // TODO: fork子进程，父进程 _exit(0)

    // TODO: 子进程 sleep(2) 后输出 "My PID=xxx, new PPID=yyy"

    /* ==== CODE END ==== */
}
''', r'''use std::os::raw::c_int;

extern "C" {
    fn fork() -> c_int;
    fn getpid() -> c_int;
    fn getppid() -> c_int;
    fn waitpid(pid: c_int, status: *mut c_int, options: c_int) -> c_int;
    fn sleep(secs: c_int) -> c_int;
    fn _exit(code: c_int) -> !;
}

fn main() {
    /* ==== CODE START ==== */
    unsafe {
        // 场景1：僵尸进程演示
        let pid1 = fork();
        if pid1 == 0 {
            _exit(0);
        } else {
            sleep(1);
            let mut status: c_int = 0;
            let reaped = waitpid(pid1, &mut status, 0);
            println!("Zombie reaped: PID={}", reaped);
        }

        // 场景2：孤儿进程演示
        let pid2 = fork();
        if pid2 == 0 {
            sleep(2);
            println!("My PID={}, new PPID={}", getpid(), getppid());
            _exit(0);
        } else {
            _exit(0);
        }
    }
    /* ==== CODE END ==== */
}
''')

# ==================== lab7_daemon_process ====================
upsert('lab7_daemon_process', 'cpp', r'''#include <cstdio>
#include <unistd.h>
#include <sys/wait.h>
#include <sys/stat.h>
#include <fcntl.h>
#include <cstdlib>
#include <ctime>

/**
 * 守护进程实现实验
 * 目标：实现 daemonize 函数并定时写入日志
 * 提示：
 *   - fork() 后父进程退出，子进程继续
 *   - setsid() 创建新会话，脱离终端控制
 *   - chdir("/") 切换到根目录，防止卸载问题
 *   - 重定向 stdin/stdout/stdout/stderr 到 /dev/null
 *   - 使用 time() + ctime() 获取时间戳
 *   - 向 /tmp/traceos_daemon.log 写入日志
 */

/* ==== CODE START ==== */
// TODO: 实现 daemonize() 函数
void daemonize() {
}

// TODO: 实现守护进程主循环（每2秒写一次日志，共5次）
void daemon_loop() {
}
/* ==== CODE END ==== */

int main() {
    /* ==== CODE START ==== */
    // TODO: fork，父进程输出 "Daemon started: PID=xxx" 后退出

    // TODO: 子进程调用 daemonize() 然后 daemon_loop()

    /* ==== CODE END ==== */
    return 0;
}
''', r'''#include <cstdio>
#include <unistd.h>
#include <sys/wait.h>
#include <sys/stat.h>
#include <fcntl.h>
#include <cstdlib>
#include <ctime>

void daemonize() {
    pid_t pid = fork();
    if (pid > 0) _exit(0);
    if (pid < 0) exit(1);
    setsid();
    chdir("/");
    umask(0);
    int fd = open("/dev/null", O_RDWR);
    dup2(fd, STDIN_FILENO);
    dup2(fd, STDOUT_FILENO);
    dup2(fd, STDERR_FILENO);
    close(fd);
}

void daemon_loop() {
    for (int i = 0; i < 5; i++) {
        sleep(2);
        time_t now = time(NULL);
        char *ts = ctime(&now);
        ts[19] = '\0';
        FILE *fp = fopen("/tmp/traceos_daemon.log", i == 0 ? "w" : "a");
        if (fp) {
            fprintf(fp, "[%s] Daemon heartbeat\n", ts + 11);
            fclose(fp);
        }
    }
}

int main() {
    pid_t pid = fork();
    if (pid < 0) {
        perror("fork");
        return 1;
    } else if (pid > 0) {
        printf("Daemon started: PID=%d\n", pid);
        _exit(0);
    } else {
        daemonize();
        daemon_loop();
    }
    return 0;
}
''')

upsert('lab7_daemon_process', 'python', r'''#!/usr/bin/env python3
"""
守护进程实现实验
目标：实现 daemonize 函数并定时写入日志
提示：
  - os.fork() 后父进程退出，子进程继续
  - os.setsid() 创建新会话，脱离终端控制
  - os.chdir("/") 切换到根目录
  - 重定向 stdin/stdout/stderr 到 /dev/null
  - 向 /tmp/traceos_daemon.log 写入日志
"""
import os
import sys
import time

# ==== CODE START ====
# TODO: 实现 daemonize() 函数
def daemonize():
    pass

# TODO: 实现守护进程主循环（每2秒写一次日志，共5次）
def daemon_loop():
    pass

# ==== CODE END ====

if __name__ == '__main__':
    # ==== CODE START ====
    # TODO: os.fork()，父进程输出 "Daemon started: PID=xxx" 后退出

    # TODO: 子进程调用 daemonize() 然后 daemon_loop()

    # ==== CODE END ====
    pass
''', r'''#!/usr/bin/env python3
import os
import sys
import time

def daemonize():
    pid = os.fork()
    if pid > 0:
        os._exit(0)
    if pid < 0:
        sys.exit(1)
    os.setsid()
    os.chdir("/")
    os.umask(0)
    devnull = os.open("/dev/null", os.O_RDWR)
    os.dup2(devnull, 0)
    os.dup2(devnull, 1)
    os.dup2(devnull, 2)
    os.close(devnull)

def daemon_loop():
    for i in range(5):
        time.sleep(2)
        ts = time.strftime("%H:%M:%S")
        mode = "w" if i == 0 else "a"
        with open("/tmp/traceos_daemon.log", mode) as f:
            f.write("[%s] Daemon heartbeat\n" % ts)

if __name__ == '__main__':
    pid = os.fork()
    if pid < 0:
        print("fork failed", file=sys.stderr)
        sys.exit(1)
    elif pid > 0:
        print("Daemon started: PID=%d" % pid)
        os._exit(0)
    else:
        daemonize()
        daemon_loop()
''')

upsert('lab7_daemon_process', 'go', r'''package main

/*
 * 守护进程实现实验
 * 目标：实现 daemonize 函数并定时写入日志
 * 提示：
 *   - fork() 后父进程退出，子进程继续
 *   - syscall.Setsid() 创建新会话，脱离终端控制
 *   - os.Chdir("/") 切换到根目录
 *   - 重定向 stdin/stdout/stderr 到 /dev/null
 *   - 向 /tmp/traceos_daemon.log 写入日志
 */
import (
    "fmt"
    "os"
    "syscall"
    "time"
)

func daemonize() {
    /* ==== CODE START ==== */
    // TODO: fork，父进程退出
    //  setsid 创建新会话
    //  chdir /
    //  重定向 stdin/stdout/stderr 到 /dev/null

    /* ==== CODE END ==== */
}

func daemonLoop() {
    /* ==== CODE START ==== */
    // TODO: 循环5次，每2秒写一条日志到 /tmp/traceos_daemon.log

    /* ==== CODE END ==== */
}

func main() {
    /* ==== CODE START ==== */
    // TODO: fork，父进程输出 "Daemon started: PID=xxx" 后退出

    // TODO: 子进程调用 daemonize() 然后 daemonLoop()

    /* ==== CODE END ==== */
}
''', r'''package main

import (
    "fmt"
    "os"
    "syscall"
    "time"
)

func daemonize() {
    /* ==== CODE START ==== */
    pid, _, _ := syscall.Syscall(syscall.SYS_FORK, 0, 0, 0)
    if pid > 0 {
        os.Exit(0)
    }
    syscall.Setsid()
    os.Chdir("/")
    devnull, _ := os.Open("/dev/null")
    syscall.Dup2(int(devnull.Fd()), 0)
    syscall.Dup2(int(devnull.Fd()), 1)
    syscall.Dup2(int(devnull.Fd()), 2)
    devnull.Close()
    /* ==== CODE END ==== */
}

func daemonLoop() {
    /* ==== CODE START ==== */
    for i := 0; i < 5; i++ {
        time.Sleep(2 * time.Second)
        ts := time.Now().Format("15:04:05")
        mode := os.O_CREATE | os.O_WRONLY
        if i > 0 {
            mode |= os.O_APPEND
        } else {
            mode |= os.O_TRUNC
        }
        f, _ := os.OpenFile("/tmp/traceos_daemon.log", mode, 0644)
        if f != nil {
            fmt.Fprintf(f, "[%s] Daemon heartbeat\n", ts)
            f.Close()
        }
    }
    /* ==== CODE END ==== */
}

func main() {
    /* ==== CODE START ==== */
    pid, _, _ := syscall.Syscall(syscall.SYS_FORK, 0, 0, 0)
    if int(pid) < 0 {
        fmt.Fprintln(os.Stderr, "fork failed")
        os.Exit(1)
    } else if pid > 0 {
        fmt.Printf("Daemon started: PID=%d\n", pid)
        os.Exit(0)
    } else {
        daemonize()
        daemonLoop()
    }
    /* ==== CODE END ==== */
}
''')

upsert('lab7_daemon_process', 'rust', r'''use std::os::raw::c_int;

/*
 * 守护进程实现实验
 * 目标：实现 daemonize 函数并定时写入日志
 * 提示：
 *   - fork() 后父进程退出，子进程继续
 *   - setsid() 创建新会话，脱离终端控制
 *   - chdir("/") 切换到根目录
 *   - 重定向 stdin/stdout/stderr 到 /dev/null
 *   - 向 /tmp/traceos_daemon.log 写入日志
 */
extern "C" {
    fn fork() -> c_int;
    fn setsid() -> c_int;
    fn chdir(path: *const u8) -> c_int;
    fn dup2(oldfd: c_int, newfd: c_int) -> c_int;
    fn open(path: *const u8, flags: c_int) -> c_int;
    fn close(fd: c_int) -> c_int;
    fn sleep(secs: c_int) -> c_int;
    fn _exit(code: c_int) -> !;
}

fn daemonize() {
    /* ==== CODE START ==== */
    // TODO: fork，父进程退出
    //  setsid 创建新会话
    //  chdir /
    //  重定向 stdin/stdout/stderr 到 /dev/null

    /* ==== CODE END ==== */
}

fn daemon_loop() {
    /* ==== CODE START ==== */
    // TODO: 循环5次，每2秒写一条日志到 /tmp/traceos_daemon.log

    /* ==== CODE END ==== */
}

fn main() {
    /* ==== CODE START ==== */
    // TODO: fork，父进程输出 "Daemon started: PID=xxx" 后退出

    // TODO: 子进程调用 daemonize() 然后 daemon_loop()

    /* ==== CODE END ==== */
}
''', r'''use std::os::raw::c_int;
use std::ffi::CString;
use std::fs::OpenOptions;
use std::io::Write;
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

extern "C" {
    fn fork() -> c_int;
    fn setsid() -> c_int;
    fn chdir(path: *const u8) -> c_int;
    fn dup2(oldfd: c_int, newfd: c_int) -> c_int;
    fn open(path: *const u8, flags: c_int) -> c_int;
    fn close(fd: c_int) -> c_int;
    fn _exit(code: c_int) -> !;
}

fn daemonize() {
    /* ==== CODE START ==== */
    unsafe {
        let pid = fork();
        if pid > 0 { _exit(0); }
        setsid();
        let root = b"/\0";
        chdir(root.as_ptr());
        let devnull = open(b"/dev/null\0".as_ptr(), 2); // O_RDWR=2
        dup2(devnull, 0);
        dup2(devnull, 1);
        dup2(devnull, 2);
        close(devnull);
    }
    /* ==== CODE END ==== */
}

fn daemon_loop() {
    /* ==== CODE START ==== */
    for i in 0..5u32 {
        thread::sleep(Duration::from_secs(2));
        let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap();
        let secs = now.as_secs();
        let hours = (secs / 3600) % 24;
        let mins = (secs / 60) % 60;
        let s = secs % 60;
        let ts = format!("{:02}:{:02}:{:02}", hours, mins, s);
        let path = "/tmp/traceos_daemon.log";
        let mut file = if i == 0 {
            OpenOptions::new().write(true).create(true).truncate(true).open(path)
        } else {
            OpenOptions::new().write(true).append(true).open(path)
        };
        if let Ok(ref mut f) = file {
            let _ = writeln!(f, "[{}] Daemon heartbeat", ts);
        }
    }
    /* ==== CODE END ==== */
}

fn main() {
    /* ==== CODE START ==== */
    unsafe {
        let pid = fork();
        if pid < 0 {
            eprintln!("fork failed");
            std::process::exit(1);
        } else if pid > 0 {
            println!("Daemon started: PID={}", pid);
            _exit(0);
        } else {
            daemonize();
            daemon_loop();
        }
    }
    /* ==== CODE END ==== */
}
''')
print('lab5-lab7 done')
