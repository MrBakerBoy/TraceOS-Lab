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

# ==================== lab4_pipe_ipc ====================
upsert('lab4_pipe_ipc', 'cpp', r'''#include <cstdio>
#include <unistd.h>
#include <sys/wait.h>
#include <cstdlib>
#include <cstring>

/**
 * 管道通信实验：父子进程双向管道
 * 目标：使用 pipe() 创建两条管道，实现父子双向通信
 * 提示：
 *   - pipe(int fd[2]) 创建管道：fd[0]读端，fd[1]写端
 *   - 父进程通过pipe1发送消息给子进程，子进程通过pipe2回复
 *   - 必须关闭不使用的管道端，否则另一端会永久阻塞
 *   - 使用 write(fd, buf, len) 和 read(fd, buf, size)
 */
int main() {
    /* ==== CODE START ==== */
    // TODO: 创建两条管道 pipe1（父->子）和 pipe2（子->父）

    // TODO: fork 创建子进程

    // TODO: 子进程：关闭pipe1写端、pipe2读端；从pipe1读消息，打印后通过pipe2回复

    // TODO: 父进程：关闭pipe1读端、pipe2写端；发送消息到pipe1，从pipe2接收回复

    // TODO: 各自输出 "[Parent] received: xxx" 或 "[Child] received: xxx"

    /* ==== CODE END ==== */
    return 0;
}
''', r'''#include <cstdio>
#include <unistd.h>
#include <sys/wait.h>
#include <cstdlib>
#include <cstring>

int main() {
    /* ==== CODE START ==== */
    int pipe1[2], pipe2[2];
    pipe(pipe1);
    pipe(pipe2);

    pid_t pid = fork();
    if (pid == 0) {
        // 子进程
        close(pipe1[1]); close(pipe2[0]);
        char buf[256];
        int n = read(pipe1[0], buf, sizeof(buf));
        buf[n] = '\0';
        printf("[Child] received: %s\n", buf);
        const char *reply = "MSG from child";
        write(pipe2[1], reply, strlen(reply));
        close(pipe1[0]); close(pipe2[1]);
        _exit(0);
    } else {
        // 父进程
        close(pipe1[0]); close(pipe2[1]);
        const char *msg = "MSG from parent";
        write(pipe1[1], msg, strlen(msg));
        char buf[256];
        int n = read(pipe2[0], buf, sizeof(buf));
        buf[n] = '\0';
        printf("[Parent] received: %s\n", buf);
        close(pipe1[1]); close(pipe2[0]);
        wait(NULL);
    }
    /* ==== CODE END ==== */
    return 0;
}
''')

upsert('lab4_pipe_ipc', 'python', r'''#!/usr/bin/env python3
"""
管道通信实验：父子进程双向管道
目标：使用 os.pipe() 创建两条管道，实现父子双向通信
提示：
  - os.pipe() 返回 (read_fd, write_fd)
  - 父进程通过pipe1发送消息给子进程，子进程通过pipe2回复
  - 必须关闭不使用的管道端，否则另一端会永久阻塞
  - 使用 os.write(fd, data) 和 os.read(fd, size)
"""
import os

# ==== CODE START ====
# TODO: 创建两条管道 pipe1（父->子）和 pipe2（子->父）

# TODO: os.fork() 创建子进程

# TODO: 子进程：关闭pipe1写端、pipe2读端；从pipe1读消息，打印后通过pipe2回复

# TODO: 父进程：关闭pipe1读端、pipe2写端；发送消息到pipe1，从pipe2接收回复

# TODO: 各自输出 "[Parent] received: xxx" 或 "[Child] received: xxx"

# ==== CODE END ====
''', r'''#!/usr/bin/env python3
import os

pipe1 = os.pipe()
pipe2 = os.pipe()

pid = os.fork()
if pid == 0:
    # 子进程
    os.close(pipe1[1])
    os.close(pipe2[0])
    data = os.read(pipe1[0], 256)
    print("[Child] received: %s" % data.decode())
    os.write(pipe2[1], b"MSG from child")
    os.close(pipe1[0])
    os.close(pipe2[1])
    os._exit(0)
else:
    # 父进程
    os.close(pipe1[0])
    os.close(pipe2[1])
    os.write(pipe1[1], b"MSG from parent")
    data = os.read(pipe2[0], 256)
    print("[Parent] received: %s" % data.decode())
    os.close(pipe1[1])
    os.close(pipe2[0])
    os.waitpid(pid, 0)
''')

upsert('lab4_pipe_ipc', 'go', r'''package main

/*
 * 管道通信实验：父子进程双向管道
 * 目标：使用 os.Pipe() 创建两条管道，实现父子双向通信
 * 提示：
 *   - Go 中 os.Pipe() 返回 (*os.File, *os.File) 分别为读端和写端
 *   - 父子进程通过管道传递数据时需要用 fork 创建子进程
 *   - 必须关闭不使用的管道端
 */
import (
    "fmt"
    "os"
    "syscall"
)

func main() {
    /* ==== CODE START ==== */
    // TODO: 创建两条管道 pipe1（父->子）和 pipe2（子->父）

    // TODO: fork 创建子进程

    // TODO: 子进程：关闭pipe1写端、pipe2读端；从pipe1读消息，打印后通过pipe2回复

    // TODO: 父进程：关闭pipe1读端、pipe2写端；发送消息到pipe1，从pipe2接收回复

    /* ==== CODE END ==== */
}
''', r'''package main

import (
    "bufio"
    "fmt"
    "os"
    "syscall"
)

func main() {
    /* ==== CODE START ==== */
    r1, w1, _ := os.Pipe()
    r2, w2, _ := os.Pipe()

    pid, _, err := syscall.Syscall(syscall.SYS_FORK, 0, 0, 0)
    if err != 0 {
        fmt.Fprintln(os.Stderr, "fork failed")
        os.Exit(1)
    }
    if pid == 0 {
        // 子进程
        w1.Close()
        r2.Close()
        reader := bufio.NewReader(r1)
        msg, _ := reader.ReadString('\n')
        if len(msg) == 0 {
            buf := make([]byte, 256)
            n, _ := r1.Read(buf)
            msg = string(buf[:n])
        }
        fmt.Printf("[Child] received: %s\n", msg)
        w2.WriteString("MSG from child")
        os.Exit(0)
    } else {
        // 父进程
        r1.Close()
        w2.Close()
        w1.WriteString("MSG from parent")
        w1.Close()
        buf := make([]byte, 256)
        n, _ := r2.Read(buf)
        fmt.Printf("[Parent] received: %s\n", string(buf[:n]))
        var status syscall.WaitStatus
        syscall.Wait4(int(pid), &status, 0, nil)
    }
    /* ==== CODE END ==== */
}
''')

upsert('lab4_pipe_ipc', 'rust', r'''use std::os::raw::c_int;

/*
 * 管道通信实验：父子进程双向管道
 * 目标：使用 pipe() 创建两条管道，实现父子双向通信
 * 提示：
 *   - pipe(fd: *mut [c_int; 2]) 创建管道：fd[0]读端，fd[1]写端
 *   - 父子进程通过管道传递数据
 *   - 必须关闭不使用的管道端
 */
extern "C" {
    fn pipe(fds: *mut c_int) -> c_int;
    fn fork() -> c_int;
    fn close(fd: c_int) -> c_int;
    fn read(fd: c_int, buf: *mut u8, count: usize) -> isize;
    fn write(fd: c_int, buf: *const u8, count: usize) -> isize;
    fn wait(status: *mut c_int) -> c_int;
}

fn main() {
    /* ==== CODE START ==== */
    // TODO: 创建两条管道 pipe1（父->子）和 pipe2（子->父）

    // TODO: fork 创建子进程

    // TODO: 子进程：关闭pipe1写端、pipe2读端；从pipe1读消息，打印后通过pipe2回复

    // TODO: 父进程：关闭pipe1读端、pipe2写端；发送消息到pipe1，从pipe2接收回复

    /* ==== CODE END ==== */
}
''', r'''use std::os::raw::c_int;

extern "C" {
    fn pipe(fds: *mut c_int) -> c_int;
    fn fork() -> c_int;
    fn close(fd: c_int) -> c_int;
    fn read(fd: c_int, buf: *mut u8, count: usize) -> isize;
    fn write(fd: c_int, buf: *const u8, count: usize) -> isize;
    fn wait(status: *mut c_int) -> c_int;
}

fn main() {
    /* ==== CODE START ==== */
    unsafe {
        let mut pipe1 = [0i32; 2];
        let mut pipe2 = [0i32; 2];
        pipe(pipe1.as_mut_ptr());
        pipe(pipe2.as_mut_ptr());

        let pid = fork();
        if pid == 0 {
            // 子进程
            close(pipe1[1]); close(pipe2[0]);
            let mut buf = [0u8; 256];
            let n = read(pipe1[0], buf.as_mut_ptr(), 256);
            let msg = std::str::from_utf8(&buf[..n as usize]).unwrap_or("");
            println!("[Child] received: {}", msg);
            let reply = b"MSG from child";
            write(pipe2[1], reply.as_ptr(), reply.len());
            close(pipe1[0]); close(pipe2[1]);
            std::process::exit(0);
        } else {
            // 父进程
            close(pipe1[0]); close(pipe2[1]);
            let msg = b"MSG from parent";
            write(pipe1[1], msg.as_ptr(), msg.len());
            let mut buf = [0u8; 256];
            let n = read(pipe2[0], buf.as_mut_ptr(), 256);
            let msg = std::str::from_utf8(&buf[..n as usize]).unwrap_or("");
            println!("[Parent] received: {}", msg);
            close(pipe1[1]); close(pipe2[0]);
            let mut status: c_int = 0;
            wait(&mut status);
        }
    }
    /* ==== CODE END ==== */
}
''')
print('lab4 done')
