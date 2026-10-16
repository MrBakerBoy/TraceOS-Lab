#!/usr/bin/env python3
import sys, subprocess

def get_exp_id(name):
    sql = f"SELECT id FROM experiments WHERE name='{name}'"
    r = subprocess.run(['docker','exec','-i','traceos-postgres','psql','-U','traceos','-d','traceos','-t','-A','-c',sql], capture_output=True, text=True)
    return r.stdout.strip()

def esc(s):
    if s is None: return 'NULL'
    return "'" + s.replace("'", "''") + "'"

def upsert(exp_name, lang, starter, reference):
    exp_id = get_exp_id(exp_name)
    if not exp_id:
        print(f'  SKIP {exp_name}: not found')
        return
    sql = f"""INSERT INTO experiment_code_templates (experiment_id, language, starter_code, reference_solution, is_published, updated_at)
VALUES ('{exp_id}', '{lang}', {esc(starter)}, {esc(reference)}, true, NOW())
ON CONFLICT (experiment_id, language) DO UPDATE SET starter_code=EXCLUDED.starter_code, reference_solution=EXCLUDED.reference_solution, updated_at=NOW();"""
    r = subprocess.run(['docker','exec','-i','traceos-postgres','psql','-U','traceos','-d','traceos','-c',sql], capture_output=True, text=True)
    if r.returncode != 0:
        print(f'  ERROR {exp_name}/{lang}: {r.stderr.strip()[:200]}')
    else:
        print(f'  OK {exp_name}/{lang}')

# ==================== lab1_fork_basic ====================
upsert('lab1_fork_basic', 'cpp', r'''#include <cstdio>
#include <unistd.h>
#include <sys/wait.h>
#include <cstdlib>

/**
 * 进程创建与父子关系实验
 * 目标：使用 fork() 创建子进程，理解 PID、PPID 和进程关系
 * 提示：
 *   - fork() 在父进程中返回子进程PID，在子进程中返回0，失败返回-1
 *   - getpid() 获取当前进程PID，getppid() 获取父进程PID
 *   - 父进程使用 wait()/waitpid() 等待子进程结束，防止产生僵尸进程
 */
int main() {
    /* ==== CODE START ==== */
    // TODO: 使用 fork() 创建子进程

    // TODO: 子进程打印 "Child: PID=xxx, PPID=yyy"

    // TODO: 父进程等待子进程结束，打印 "Parent: PID=xxx, Child PID=yyy"

    // TODO: 处理 fork 失败的情况（pid < 0）

    /* ==== CODE END ==== */
    return 0;
}
''', r'''#include <cstdio>
#include <unistd.h>
#include <sys/wait.h>
#include <cstdlib>

int main() {
    /* ==== CODE START ==== */
    pid_t pid = fork();

    if (pid < 0) {
        perror("fork");
        return 1;
    } else if (pid == 0) {
        // 子进程：打印自己的PID和PPID
        printf("Child: PID=%d, PPID=%d\n", getpid(), getppid());
        _exit(0);
    } else {
        // 父进程：等待子进程，然后打印信息
        int status;
        pid_t child_pid = wait(&status);
        printf("Parent: PID=%d, Child PID=%d\n", getpid(), child_pid);
    }
    /* ==== CODE END ==== */
    return 0;
}
''')

upsert('lab1_fork_basic', 'python', r'''#!/usr/bin/env python3
"""
进程创建与父子关系实验
目标：使用 os.fork() 创建子进程，理解 PID、PPID 和进程关系
提示：
  - os.fork() 在父进程中返回子进程PID(>0)，在子进程中返回0，失败抛出OSError
  - os.getpid() 获取当前进程PID，os.getppid() 获取父进程PID
  - 父进程使用 os.waitpid() 等待子进程结束，防止产生僵尸进程
"""
import os
import sys

# ==== CODE START ====
# TODO: 使用 os.fork() 创建子进程

# TODO: 子进程打印 "Child: PID=xxx, PPID=yyy"

# TODO: 父进程等待子进程结束，打印 "Parent: PID=xxx, Child PID=yyy"

# TODO: 处理 fork 失败的情况（捕获 OSError）

# ==== CODE END ====
''', r'''#!/usr/bin/env python3
import os
import sys

pid = os.fork()

if pid == 0:
    # 子进程：打印自己的PID和PPID
    print("Child: PID=%d, PPID=%d" % (os.getpid(), os.getppid()))
    os._exit(0)
else:
    # 父进程：等待子进程，然后打印信息
    child_pid, status = os.waitpid(pid, 0)
    print("Parent: PID=%d, Child PID=%d" % (os.getpid(), child_pid))
''')

upsert('lab1_fork_basic', 'go', r'''package main

/*
 * 进程创建与父子关系实验
 * 目标：使用 fork() 创建子进程，理解 PID、PPID 和进程关系
 * 提示：
 *   - Go 中通过 syscall.Syscall(syscall.SYS_FORK, 0, 0, 0) 调用 fork
 *   - 返回值: 父进程得到子进程PID(>0)，子进程得到0，出错时err!=0
 *   - os.Getpid() 获取当前进程PID，os.Getppid() 获取父进程PID
 *   - 父进程使用 syscall.Wait4() 等待子进程结束
 *   - 子进程必须调用 os.Exit() 立即退出，避免影响 Go 运行时
 */
import (
    "fmt"
    "os"
    "syscall"
)

func main() {
    /* ==== CODE START ==== */
    // TODO: 使用 syscall.Syscall(syscall.SYS_FORK, 0, 0, 0) 创建子进程

    // TODO: 子进程打印 "Child: PID=xxx, PPID=yyy" 后 os.Exit(0)

    // TODO: 父进程等待子进程结束，打印 "Parent: PID=xxx, Child PID=yyy"

    // TODO: 处理 fork 失败的情况

    /* ==== CODE END ==== */
}
''', r'''package main

import (
    "fmt"
    "os"
    "syscall"
)

func main() {
    /* ==== CODE START ==== */
    pid, _, err := syscall.Syscall(syscall.SYS_FORK, 0, 0, 0)
    if err != 0 {
        fmt.Fprintf(os.Stderr, "fork failed: %v\n", err)
        os.Exit(1)
    }
    if pid == 0 {
        // 子进程
        fmt.Printf("Child: PID=%d, PPID=%d\n", os.Getpid(), os.Getppid())
        os.Exit(0)
    } else {
        // 父进程
        var status syscall.WaitStatus
        syscall.Wait4(int(pid), &status, 0, nil)
        fmt.Printf("Parent: PID=%d, Child PID=%d\n", os.Getpid(), pid)
    }
    /* ==== CODE END ==== */
}
''')

upsert('lab1_fork_basic', 'rust', r'''use std::os::raw::c_int;

/*
 * 进程创建与父子关系实验
 * 目标：使用 fork() 创建子进程，理解 PID、PPID 和进程关系
 * 提示：
 *   - Rust 中通过 extern "C" 声明 fork/getpid/getppid/wait 等 libc 函数
 *   - fork() 在父进程中返回子进程PID(>0)，在子进程中返回0，失败返回-1
 *   - getpid() 获取当前进程PID，getppid() 获取父进程PID
 *   - 父进程使用 wait() 等待子进程结束
 *   - 所有 libc 调用需要在 unsafe 块中执行
 */
extern "C" {
    fn fork() -> c_int;
    fn getpid() -> c_int;
    fn getppid() -> c_int;
    fn wait(status: *mut c_int) -> c_int;
}

fn main() {
    /* ==== CODE START ==== */
    // TODO: 使用 fork() 创建子进程（unsafe 块）

    // TODO: 子进程打印 "Child: PID=xxx, PPID=yyy" 后 std::process::exit(0)

    // TODO: 父进程等待子进程结束，打印 "Parent: PID=xxx, Child PID=yyy"

    // TODO: 处理 fork 失败的情况（返回值 < 0）

    /* ==== CODE END ==== */
}
''', r'''use std::os::raw::c_int;

extern "C" {
    fn fork() -> c_int;
    fn getpid() -> c_int;
    fn getppid() -> c_int;
    fn wait(status: *mut c_int) -> c_int;
}

fn main() {
    /* ==== CODE START ==== */
    unsafe {
        let pid = fork();
        if pid < 0 {
            eprintln!("fork failed");
            std::process::exit(1);
        } else if pid == 0 {
            // 子进程
            println!("Child: PID={}, PPID={}", getpid(), getppid());
            std::process::exit(0);
        } else {
            // 父进程
            let mut status: c_int = 0;
            wait(&mut status);
            println!("Parent: PID={}, Child PID={}", getpid(), pid);
        }
    }
    /* ==== CODE END ==== */
}
''')
print('lab1 done')

# ==================== lab2_fork_tree ====================
upsert('lab2_fork_tree', 'cpp', r'''#include <cstdio>
#include <unistd.h>
#include <sys/wait.h>
#include <cstdlib>

/**
 * 进程树与进程层次结构实验
 * 目标：创建三级进程树（根→2子→4孙，共7个进程）
 * 提示：
 *   - 每层父进程fork出两个子进程后，需要用for循环waitpid回收
 *   - 子进程中用return或_exit退出，防止继续创建进程
 *   - 使用level变量追踪当前层级
 */
void create_children(int level) {
    /* ==== CODE START ==== */
    // TODO: 当level >= 2时返回（最深层）

    // TODO: 循环2次，每次fork一个子进程
    
    // TODO: 子进程中打印 "Level X: PID=xxx, PPID=yyy"，然后递归调用create_children(level+1)
    
    // TODO: 子进程退出（防止继续循环）

    // TODO: 循环结束后，父进程waitpid回收所有子进程

    /* ==== CODE END ==== */
}

int main() {
    printf("Level 0: PID=%d, PPID=%d\n", getpid(), getppid());
    create_children(1);
    return 0;
}
''', r'''#include <cstdio>
#include <unistd.h>
#include <sys/wait.h>
#include <cstdlib>

void create_children(int level) {
    /* ==== CODE START ==== */
    if (level >= 2) return;

    for (int i = 0; i < 2; i++) {
        pid_t pid = fork();
        if (pid == 0) {
            // 子进程
            printf("Level %d: PID=%d, PPID=%d\n", level, getpid(), getppid());
            create_children(level + 1);
            _exit(0);
        }
    }
    // 父进程等待所有子进程
    for (int i = 0; i < 2; i++) {
        waitpid(-1, NULL, 0);
    }
    /* ==== CODE END ==== */
}

int main() {
    printf("Level 0: PID=%d, PPID=%d\n", getpid(), getppid());
    create_children(1);
    return 0;
}
''')

upsert('lab2_fork_tree', 'python', r'''#!/usr/bin/env python3
"""
进程树与进程层次结构实验
目标：创建三级进程树（根→2子→4孙，共7个进程）
提示：
  - 每层父进程fork出两个子进程后，需要用for循环os.waitpid回收
  - 子进程中用os._exit退出，防止继续创建进程
  - 使用level变量追踪当前层级
"""
import os
import sys

def create_children(level):
    # ==== CODE START ====
    # TODO: 当level >= 2时返回（最深层）

    # TODO: 循环2次，每次os.fork()一个子进程

    # TODO: 子进程中打印 "Level X: PID=xxx, PPID=yyy"，然后递归调用create_children(level+1)

    # TODO: 子进程退出（os._exit(0)）

    # TODO: 循环结束后，父进程os.waitpid回收所有子进程

    # ==== CODE END ====
    pass

if __name__ == '__main__':
    print("Level 0: PID=%d, PPID=%d" % (os.getpid(), os.getppid()))
    create_children(1)
''', r'''#!/usr/bin/env python3
import os
import sys

def create_children(level):
    if level >= 2:
        return
    for i in range(2):
        pid = os.fork()
        if pid == 0:
            # 子进程
            print("Level %d: PID=%d, PPID=%d" % (level, os.getpid(), os.getppid()))
            create_children(level + 1)
            os._exit(0)
    # 父进程等待所有子进程
    for i in range(2):
        os.waitpid(-1, 0)

if __name__ == '__main__':
    print("Level 0: PID=%d, PPID=%d" % (os.getpid(), os.getppid()))
    create_children(1)
''')

upsert('lab2_fork_tree', 'go', r'''package main

/*
 * 进程树与进程层次结构实验
 * 目标：创建三级进程树（根→2子→4孙，共7个进程）
 * 提示：
 *   - 每层父进程fork出两个子进程后，需要用for循环syscall.Wait4回收
 *   - 子进程中用os.Exit退出，防止继续创建进程
 *   - 使用level变量追踪当前层级
 */
import (
    "fmt"
    "os"
    "syscall"
)

func createChildren(level int) {
    /* ==== CODE START ==== */
    // TODO: 当level >= 2时返回（最深层）

    // TODO: 循环2次，每次fork一个子进程

    // TODO: 子进程中打印 "Level X: PID=xxx, PPID=yyy"，然后递归调用createChildren(level+1)

    // TODO: 子进程退出（os.Exit(0)）

    // TODO: 循环结束后，父进程syscall.Wait4回收所有子进程

    /* ==== CODE END ==== */
}

func main() {
    fmt.Printf("Level 0: PID=%d, PPID=%d\n", os.Getpid(), os.Getppid())
    createChildren(1)
}
''', r'''package main

import (
    "fmt"
    "os"
    "syscall"
)

func createChildren(level int) {
    /* ==== CODE START ==== */
    if level >= 2 {
        return
    }
    for i := 0; i < 2; i++ {
        pid, _, err := syscall.Syscall(syscall.SYS_FORK, 0, 0, 0)
        if err != 0 {
            fmt.Fprintf(os.Stderr, "fork failed\n")
            os.Exit(1)
        }
        if pid == 0 {
            // 子进程
            fmt.Printf("Level %d: PID=%d, PPID=%d\n", level, os.Getpid(), os.Getppid())
            createChildren(level + 1)
            os.Exit(0)
        }
    }
    // 父进程等待所有子进程
    for i := 0; i < 2; i++ {
        var status syscall.WaitStatus
        syscall.Wait4(-1, &status, 0, nil)
    }
    /* ==== CODE END ==== */
}

func main() {
    fmt.Printf("Level 0: PID=%d, PPID=%d\n", os.Getpid(), os.Getppid())
    createChildren(1)
}
''')

upsert('lab2_fork_tree', 'rust', r'''use std::os::raw::c_int;

/*
 * 进程树与进程层次结构实验
 * 目标：创建三级进程树（根→2子→4孙，共7个进程）
 * 提示：
 *   - 每层父进程fork出两个子进程后，需要用for循环waitpid回收
 *   - 子进程中用std::process::exit退出，防止继续创建进程
 *   - 使用level变量追踪当前层级
 */
extern "C" {
    fn fork() -> c_int;
    fn getpid() -> c_int;
    fn getppid() -> c_int;
    fn waitpid(pid: c_int, status: *mut c_int, options: c_int) -> c_int;
}

fn create_children(level: i32) {
    /* ==== CODE START ==== */
    // TODO: 当level >= 2时返回（最深层）

    // TODO: 循环2次，每次fork一个子进程

    // TODO: 子进程中打印 "Level X: PID=xxx, PPID=yyy"，然后递归调用create_children(level+1)

    // TODO: 子进程退出（std::process::exit(0)）

    // TODO: 循环结束后，父进程waitpid回收所有子进程

    /* ==== CODE END ==== */
}

fn main() {
    unsafe {
        println!("Level 0: PID={}, PPID={}", getpid(), getppid());
    }
    create_children(1);
}
''', r'''use std::os::raw::c_int;

extern "C" {
    fn fork() -> c_int;
    fn getpid() -> c_int;
    fn getppid() -> c_int;
    fn waitpid(pid: c_int, status: *mut c_int, options: c_int) -> c_int;
}

fn create_children(level: i32) {
    /* ==== CODE START ==== */
    if level >= 2 {
        return;
    }
    unsafe {
        for _ in 0..2 {
            let pid = fork();
            if pid == 0 {
                // 子进程
                println!("Level {}: PID={}, PPID={}", level, getpid(), getppid());
                create_children(level + 1);
                std::process::exit(0);
            }
        }
        // 父进程等待所有子进程
        for _ in 0..2 {
            let mut status: c_int = 0;
            waitpid(-1, &mut status, 0);
        }
    }
    /* ==== CODE END ==== */
}

fn main() {
    unsafe {
        println!("Level 0: PID={}, PPID={}", getpid(), getppid());
    }
    create_children(1);
}
''')

# ==================== lab3_exec_ls ====================
upsert('lab3_exec_ls', 'cpp', r'''#include <cstdio>
#include <unistd.h>
#include <sys/wait.h>
#include <cstdlib>

/**
 * exec系列函数实验：进程替换
 * 目标：子进程中使用 execvp 执行 "ls -l" 命令
 * 提示：
 *   - execvp(const char *file, char *const argv[])，argv必须以NULL结尾
 *   - execvp 成功后不会返回，只有失败才返回-1
 *   - 父进程用 waitpid 获取子进程退出状态（WIFEXITED/WEXITSTATUS）
 */
int main() {
    /* ==== CODE START ==== */
    // TODO: fork创建子进程

    // TODO: 子进程中：构建argv数组，用execvp执行 "ls -l"

    // TODO: 如果execvp失败，输出 "Exec failed"，exit(1)

    // TODO: 父进程中：用waitpid等待子进程，检查退出状态

    /* ==== CODE END ==== */
    return 0;
}
''', r'''#include <cstdio>
#include <unistd.h>
#include <sys/wait.h>
#include <cstdlib>

int main() {
    /* ==== CODE START ==== */
    pid_t pid = fork();
    if (pid < 0) {
        perror("fork");
        return 1;
    } else if (pid == 0) {
        // 子进程：执行 ls -l
        char *argv[] = {(char *)"ls", (char *)"-l", NULL};
        execvp("ls", argv);
        // 只有 execvp 失败才会执行到这里
        printf("Exec failed\n");
        exit(1);
    } else {
        // 父进程：等待子进程
        int status;
        waitpid(pid, &status, 0);
        if (WIFEXITED(status)) {
            printf("Child exit status: %d\n", WEXITSTATUS(status));
        }
    }
    /* ==== CODE END ==== */
    return 0;
}
''')

upsert('lab3_exec_ls', 'python', r'''#!/usr/bin/env python3
"""
exec系列函数实验：进程替换
目标：子进程中使用 os.execvp 执行 "ls -l" 命令
提示：
  - os.execvp(file, args) 会替换当前进程映像，成功后不会返回
  - args 是参数列表，第一个参数通常是程序名
  - 父进程用 os.waitpid 获取子进程退出状态
"""
import os
import sys

# ==== CODE START ====
# TODO: os.fork() 创建子进程

# TODO: 子进程中：用 os.execvp 执行 "ls -l"

# TODO: 如果 execvp 失败，输出 "Exec failed"，sys.exit(1)

# TODO: 父进程中：用 os.waitpid 等待子进程，输出 "Child exit status: N"

# ==== CODE END ====
''', r'''#!/usr/bin/env python3
import os
import sys

pid = os.fork()
if pid == 0:
    # 子进程：执行 ls -l
    os.execvp("ls", ["ls", "-l"])
    # 只有 execvp 失败才会执行到这里
    print("Exec failed")
    sys.exit(1)
else:
    # 父进程：等待子进程
    child_pid, status = os.waitpid(pid, 0)
    if os.WIFEXITED(status):
        print("Child exit status: %d" % os.WEXITSTATUS(status))
''')

upsert('lab3_exec_ls', 'go', r'''package main

/*
 * exec系列函数实验：进程替换
 * 目标：子进程中使用 exec.Command 执行 "ls -l" 命令
 * 提示：
 *   - Go 中用 exec.Command("ls", "-l") 创建子进程命令
 *   - cmd.Run() 启动并等待子进程完成
 *   - 也可以用 syscall.Exec 替换当前进程映像（类似 C 的 execvp）
 *   - 父进程通过 cmd.ProcessState.ExitCode() 获取退出状态
 */
import (
    "fmt"
    "os/exec"
)

func main() {
    /* ==== CODE START ==== */
    // TODO: 创建 exec.Command("ls", "-l") 命令

    // TODO: 运行命令，如果失败输出 "Exec failed"

    // TODO: 输出 "Child exit status: N"

    /* ==== CODE END ==== */
}
''', r'''package main

import (
    "fmt"
    "os/exec"
)

func main() {
    /* ==== CODE START ==== */
    cmd := exec.Command("ls", "-l")
    err := cmd.Run()
    if err != nil {
        fmt.Println("Exec failed")
    }
    if cmd.ProcessState != nil {
        fmt.Printf("Child exit status: %d\n", cmd.ProcessState.ExitCode())
    }
    /* ==== CODE END ==== */
}
''')

upsert('lab3_exec_ls', 'rust', r'''use std::os::raw::c_int;
use std::process::Command;

/*
 * exec系列函数实验：进程替换
 * 目标：子进程中使用 execvp 执行 "ls -l" 命令
 * 提示：
 *   - Rust 中可以用 std::process::Command 执行外部命令
 *   - 也可以通过 extern "C" 调用 execvp 进行进程替换
 *   - 父进程用 waitpid 获取子进程退出状态
 */
extern "C" {
    fn fork() -> c_int;
    fn waitpid(pid: c_int, status: *mut c_int, options: c_int) -> c_int;
}

fn main() {
    /* ==== CODE START ==== */
    // TODO: fork创建子进程

    // TODO: 子进程中：用 Command::new("ls").arg("-l").exec() 执行

    // TODO: 如果 exec 失败，输出 "Exec failed"

    // TODO: 父进程中：用 waitpid 等待子进程，输出 "Child exit status: N"

    /* ==== CODE END ==== */
}
''', r'''use std::os::raw::c_int;
use std::process::Command;

extern "C" {
    fn fork() -> c_int;
    fn waitpid(pid: c_int, status: *mut c_int, options: c_int) -> c_int;
}

fn main() {
    /* ==== CODE START ==== */
    unsafe {
        let pid = fork();
        if pid < 0 {
            eprintln!("fork failed");
            std::process::exit(1);
        } else if pid == 0 {
            // 子进程：执行 ls -l
            let err = Command::new("ls").arg("-l").exec();
            // 只有 exec 失败才会执行到这里
            eprintln!("Exec failed: {:?}", err);
            std::process::exit(1);
        } else {
            // 父进程：等待子进程
            let mut status: c_int = 0;
            waitpid(pid, &mut status, 0);
            println!("Child exit status: {}", status >> 8);
        }
    }
    /* ==== CODE END ==== */
}
''')
print('lab2-lab3 done')
