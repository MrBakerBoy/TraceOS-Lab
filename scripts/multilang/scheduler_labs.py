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

# ==================== lab24_sched_sim ====================
upsert('lab24_sched_sim', 'cpp', r'''#include <cstdio>
#include <cstring>
#include <climits>

/**
 * 调度算法模拟实验：FCFS/SJF/RR/Priority
 * 目标：实现4种经典非抢占调度算法，比较平均等待时间和周转时间
 * 提示：
 *   - FCFS：按到达时间排序，先到先服务
 *   - SJF：选择当前已到达且burst最小的进程
 *   - RR：每个进程运行最多time_slice后就绪到队尾
 *   - Priority：选择已到达且优先级最高的进程
 *   - 等待时间 = 完成时间 - 到达时间 - CPU执行时间
 *   - 周转时间 = 完成时间 - 到达时间
 */
struct Process {
    int pid, arrival, burst, priority;
    int remaining, wait, turnaround, finish, done;
};

void fcfs(Process p[], int n) {
    /* ==== CODE START ==== */
    // TODO: 按到达时间排序，依次执行
    //  输出 "FCFS: avg wait=X, avg turnaround=Y"

    /* ==== CODE END ==== */
}

void sjf(Process p[], int n) {
    /* ==== CODE START ==== */
    // TODO: 每次选择已到达且burst最短的进程

    /* ==== CODE END ==== */
}

void rr(Process p[], int n, int quantum) {
    /* ==== CODE START ==== */
    // TODO: 时间片轮转调度

    /* ==== CODE END ==== */
}

void priority_sched(Process p[], int n) {
    /* ==== CODE START ==== */
    // TODO: 优先级调度（数字越小优先级越高）

    /* ==== CODE END ==== */
}

int main() {
    Process procs[] = {{1,0,8,2}, {2,1,4,1}, {3,2,9,3}, {4,3,5,2}};
    int n = 4;
    /* ==== CODE START ==== */
    // TODO: 依次调用4种算法
    //  最终输出 "Scheduler simulation complete"

    /* ==== CODE END ==== */
    return 0;
}
''', r'''#include <cstdio>
#include <cstring>
#include <climits>

struct Process { int pid, arrival, burst, priority, remaining, wait, turnaround, finish, done; };

void fcfs(Process p[], int n) {
    for (int i=0;i<n-1;i++) for (int j=i+1;j<n;j++) if (p[i].arrival>p[j].arrival) { Process t=p[i];p[i]=p[j];p[j]=t; }
    int time=0; double tw=0,tt=0;
    for (int i=0;i<n;i++) { if(time<p[i].arrival)time=p[i].arrival; p[i].wait=time-p[i].arrival; time+=p[i].burst; p[i].turnaround=time-p[i].arrival; tw+=p[i].wait; tt+=p[i].turnaround; }
    printf("FCFS: avg wait=%.1f, avg turnaround=%.1f\n", tw/n, tt/n);
}
void sjf(Process p[], int n) {
    int done=0,time=0; double tw=0,tt=0; for(int i=0;i<n;i++)p[i].done=0;
    while(done<n){ int b=-1,m=INT_MAX; for(int i=0;i<n;i++) if(!p[i].done&&p[i].arrival<=time&&p[i].burst<m){b=i;m=p[i].burst;} if(b==-1){time++;continue;} p[b].wait=time-p[b].arrival; time+=p[b].burst; p[b].turnaround=time-p[b].arrival; tw+=p[b].wait;tt+=p[b].turnaround; p[b].done=1;done++; }
    printf("SJF:  avg wait=%.1f, avg turnaround=%.1f\n", tw/n, tt/n);
}
void rr(Process p[], int n, int q) {
    for(int i=0;i<n;i++){p[i].remaining=p[i].burst;p[i].done=0;} int time=0,done=0; double tw=0,tt=0;
    while(done<n){ int run=0; for(int i=0;i<n;i++) if(!p[i].done&&p[i].arrival<=time){ int t=p[i].remaining<q?p[i].remaining:q; p[i].remaining-=t;time+=t;run=1; if(p[i].remaining==0){p[i].done=1;done++;p[i].turnaround=time-p[i].arrival;p[i].wait=p[i].turnaround-p[i].burst;tw+=p[i].wait;tt+=p[i].turnaround;}} } if(!run)time++; }
    printf("RR:   avg wait=%.1f, avg turnaround=%.1f\n", tw/n, tt/n);
}
void priority_sched(Process p[], int n) {
    int done=0,time=0; double tw=0,tt=0; for(int i=0;i<n;i++)p[i].done=0;
    while(done<n){ int b=-1,m=INT_MAX; for(int i=0;i<n;i++) if(!p[i].done&&p[i].arrival<=time&&p[i].priority<m){b=i;m=p[i].priority;} if(b==-1){time++;continue;} p[b].wait=time-p[b].arrival; time+=p[b].burst; p[b].turnaround=time-p[b].arrival; tw+=p[b].wait;tt+=p[b].turnaround; p[b].done=1;done++; }
    printf("Priority: avg wait=%.1f, avg turnaround=%.1f\n", tw/n, tt/n);
}
int main() {
    Process p[]={ {1,0,8,2},{2,1,4,1},{3,2,9,3},{4,3,5,2} };
    fcfs(p,4); sjf(p,4); rr(p,4,2); priority_sched(p,4);
    printf("Scheduler simulation complete\n");
    return 0;
}
''')

upsert('lab24_sched_sim', 'python', r'''#!/usr/bin/env python3
"""
调度算法模拟实验：FCFS/SJF/RR/Priority
目标：实现4种经典非抢占调度算法，比较平均等待时间和周转时间
提示：
  - FCFS：按到达时间排序，先到先服务
  - SJF：选择当前已到达且burst最小的进程
  - RR：每个进程运行最多time_slice后就绪到队尾
  - Priority：选择已到达且优先级最高的进程
  - 等待时间 = 完成时间 - 到达时间 - CPU执行时间
  - 周转时间 = 完成时间 - 到达时间
"""
import copy

class Process:
    def __init__(self, pid, arrival, burst, priority):
        self.pid = pid
        self.arrival = arrival
        self.burst = burst
        self.priority = priority
        self.remaining = burst
        self.wait = 0
        self.turnaround = 0
        self.done = False

def fcfs(procs):
    # ==== CODE START ====
    # TODO: 按到达时间排序，依次执行
    #  输出 "FCFS: avg wait=X, avg turnaround=Y"
    # ==== CODE END ====
    pass

def sjf(procs):
    # ==== CODE START ====
    # TODO: 每次选择已到达且burst最短的进程
    # ==== CODE END ====
    pass

def rr(procs, quantum):
    # ==== CODE START ====
    # TODO: 时间片轮转调度
    # ==== CODE END ====
    pass

def priority_sched(procs):
    # ==== CODE START ====
    # TODO: 优先级调度（数字越小优先级越高）
    # ==== CODE END ====
    pass

if __name__ == '__main__':
    procs = [Process(1,0,8,2), Process(2,1,4,1), Process(3,2,9,3), Process(4,3,5,2)]
    # ==== CODE START ====
    # TODO: 依次调用4种算法，最终输出 "Scheduler simulation complete"
    # ==== CODE END ====
    pass
''', r'''#!/usr/bin/env python3
import copy

class Process:
    def __init__(self, pid, arrival, burst, priority):
        self.pid=pid; self.arrival=arrival; self.burst=burst; self.priority=priority
        self.remaining=burst; self.wait=0; self.turnaround=0; self.done=False

def fcfs(procs):
    p=copy.deepcopy(procs)
    p.sort(key=lambda x:x.arrival)
    time=0; tw=0; tt=0
    for i in range(len(p)):
        if time<p[i].arrival: time=p[i].arrival
        p[i].wait=time-p[i].arrival; time+=p[i].burst; p[i].turnaround=time-p[i].arrival
        tw+=p[i].wait; tt+=p[i].turnaround
    print("FCFS: avg wait=%.1f, avg turnaround=%.1f" % (tw/len(p), tt/len(p)))

def sjf(procs):
    p=copy.deepcopy(procs); done=0; time=0; tw=0; tt=0
    while done<len(p):
        best=-1; min_b=999999
        for i in range(len(p)):
            if not p[i].done and p[i].arrival<=time and p[i].burst<min_b: best=i; min_b=p[i].burst
        if best==-1: time+=1; continue
        p[best].wait=time-p[best].arrival; time+=p[best].burst; p[best].turnaround=time-p[best].arrival
        tw+=p[best].wait; tt+=p[best].turnaround; p[best].done=True; done+=1
    print("SJF:  avg wait=%.1f, avg turnaround=%.1f" % (tw/len(p), tt/len(p)))

def rr(procs, quantum):
    p=copy.deepcopy(procs); done=0; time=0; tw=0; tt=0
    while done<len(p):
        run=False
        for i in range(len(p)):
            if not p[i].done and p[i].arrival<=time:
                t=min(p[i].remaining, quantum); p[i].remaining-=t; time+=t; run=True
                if p[i].remaining==0:
                    p[i].done=True; done+=1; p[i].turnaround=time-p[i].arrival; p[i].wait=p[i].turnaround-p[i].burst
                    tw+=p[i].wait; tt+=p[i].turnaround
        if not run: time+=1
    print("RR:   avg wait=%.1f, avg turnaround=%.1f" % (tw/len(p), tt/len(p)))

def priority_sched(procs):
    p=copy.deepcopy(procs); done=0; time=0; tw=0; tt=0
    while done<len(p):
        best=-1; min_pr=999999
        for i in range(len(p)):
            if not p[i].done and p[i].arrival<=time and p[i].priority<min_pr: best=i; min_pr=p[i].priority
        if best==-1: time+=1; continue
        p[best].wait=time-p[best].arrival; time+=p[best].burst; p[best].turnaround=time-p[best].arrival
        tw+=p[best].wait; tt+=p[best].turnaround; p[best].done=True; done+=1
    print("Priority: avg wait=%.1f, avg turnaround=%.1f" % (tw/len(p), tt/len(p)))

if __name__ == '__main__':
    procs=[Process(1,0,8,2),Process(2,1,4,1),Process(3,2,9,3),Process(4,3,5,2)]
    fcfs(procs); sjf(procs); rr(procs,2); priority_sched(procs)
    print("Scheduler simulation complete")
''')

upsert('lab24_sched_sim', 'go', r'''package main

/*
 * 调度算法模拟实验：FCFS/SJF/RR/Priority
 * 目标：实现4种经典非抢占调度算法，比较平均等待时间和周转时间
 */
import (
    "fmt"
    "math"
)

type Process struct {
    pid, arrival, burst, priority     int
    remaining, wait, turnaround, done int
}

func fcfs(p []Process) {
    /* ==== CODE START ==== */
    // TODO: 按到达时间排序，依次执行
    //  输出 "FCFS: avg wait=X, avg turnaround=Y"
    /* ==== CODE END ==== */
}

func sjf(p []Process) {
    /* ==== CODE START ==== */
    // TODO: 每次选择已到达且burst最短的进程
    /* ==== CODE END ==== */
}

func rr(p []Process, quantum int) {
    /* ==== CODE START ==== */
    // TODO: 时间片轮转调度
    /* ==== CODE END ==== */
}

func prioritySched(p []Process) {
    /* ==== CODE START ==== */
    // TODO: 优先级调度
    /* ==== CODE END ==== */
}

func main() {
    procs := []Process{{1,0,8,2,0,0,0,0},{2,1,4,1,0,0,0,0},{3,2,9,3,0,0,0,0},{4,3,5,2,0,0,0,0}}
    /* ==== CODE START ==== */
    // TODO: 依次调用4种算法，最终输出 "Scheduler simulation complete"
    /* ==== CODE END ==== */
}
''', r'''package main

import "fmt"

type Process struct{ pid,arrival,burst,priority,remaining,wait,turnaround,done int }

func fcfs(p []Process){ n:=len(p)
    for i:=0;i<n-1;i++{for j:=i+1;j<n;j++{if p[i].arrival>p[j].arrival{p[i],p[j]=p[j],p[i]}}}
    time,tw,tt:=0,0.0,0.0
    for i:=0;i<n;i++{if time<p[i].arrival{time=p[i].arrival};p[i].wait=time-p[i].arrival;time+=p[i].burst;p[i].turnaround=time-p[i].arrival;tw+=float64(p[i].wait);tt+=float64(p[i].turnaround)}
    fmt.Printf("FCFS: avg wait=%.1f, avg turnaround=%.1f\n",tw/float64(n),tt/float64(n))
}
func sjf(p []Process){ n:=len(p);done,time,tw,tt:=0,0,0.0,0.0
    for done<n{b,m:=-1,1<<30;for i:=0;i<n;i++{if p[i].done==0&&p[i].arrival<=time&&p[i].burst<m{b,m=i,p[i].burst}};if b==-1{time++;continue};p[b].wait=time-p[b].arrival;time+=p[b].burst;p[b].turnaround=time-p[b].arrival;tw+=float64(p[b].wait);tt+=float64(p[b].turnaround);p[b].done=1;done++}
    fmt.Printf("SJF:  avg wait=%.1f, avg turnaround=%.1f\n",tw/float64(n),tt/float64(n))
}
func rr(p []Process,q int){ n:=len(p);done,time,tw,tt:=0,0,0.0,0.0
    for done<n{run:=false;for i:=0;i<n;i++{if p[i].done==0&&p[i].arrival<=time{t:=p[i].remaining;if t>q{t=q};p[i].remaining-=t;time+=t;run=true;if p[i].remaining==0{p[i].done=1;done++;p[i].turnaround=time-p[i].arrival;p[i].wait=p[i].turnaround-p[i].burst;tw+=float64(p[i].wait);tt+=float64(p[i].turnaround)}}};if !run{time++}}
    fmt.Printf("RR:   avg wait=%.1f, avg turnaround=%.1f\n",tw/float64(n),tt/float64(n))
}
func prioritySched(p []Process){ n:=len(p);done,time,tw,tt:=0,0,0.0,0.0
    for done<n{b,m:=-1,1<<30;for i:=0;i<n;i++{if p[i].done==0&&p[i].arrival<=time&&p[i].priority<m{b,m=i,p[i].priority}};if b==-1{time++;continue};p[b].wait=time-p[b].arrival;time+=p[b].burst;p[b].turnaround=time-p[b].arrival;tw+=float64(p[b].wait);tt+=float64(p[b].turnaround);p[b].done=1;done++}
    fmt.Printf("Priority: avg wait=%.1f, avg turnaround=%.1f\n",tw/float64(n),tt/float64(n))
}
func main(){
    p:=[]Process{{1,0,8,2,8,0,0,0},{2,1,4,1,4,0,0,0},{3,2,9,3,9,0,0,0},{4,3,5,2,5,0,0,0}}
    fcfs(p);sjf(p);rr(p,2);prioritySched(p)
    fmt.Println("Scheduler simulation complete")
}
''')

upsert('lab24_sched_sim', 'rust', r'''/*
 * 调度算法模拟实验：FCFS/SJF/RR/Priority
 * 目标：实现4种经典非抢占调度算法，比较平均等待时间和周转时间
 */
#[derive(Clone)]
struct Process {
    pid: i32, arrival: i32, burst: i32, priority: i32,
    remaining: i32, wait: i32, turnaround: i32, done: bool,
}

fn fcfs(p: &mut Vec<Process>) {
    /* ==== CODE START ==== */
    // TODO: 按到达时间排序，依次执行
    //  输出 "FCFS: avg wait=X, avg turnaround=Y"
    /* ==== CODE END ==== */
}

fn sjf(p: &mut Vec<Process>) {
    /* ==== CODE START ==== */
    // TODO: 每次选择已到达且burst最短的进程
    /* ==== CODE END ==== */
}

fn rr(p: &mut Vec<Process>, quantum: i32) {
    /* ==== CODE START ==== */
    // TODO: 时间片轮转调度
    /* ==== CODE END ==== */
}

fn priority_sched(p: &mut Vec<Process>) {
    /* ==== CODE START ==== */
    // TODO: 优先级调度
    /* ==== CODE END ==== */
}

fn main() {
    let mut procs = vec![
        Process{pid:1,arrival:0,burst:8,priority:2,remaining:8,wait:0,turnaround:0,done:false},
        Process{pid:2,arrival:1,burst:4,priority:1,remaining:4,wait:0,turnaround:0,done:false},
        Process{pid:3,arrival:2,burst:9,priority:3,remaining:9,wait:0,turnaround:0,done:false},
        Process{pid:4,arrival:3,burst:5,priority:2,remaining:5,wait:0,turnaround:0,done:false},
    ];
    /* ==== CODE START ==== */
    // TODO: 依次调用4种算法，最终输出 "Scheduler simulation complete"
    /* ==== CODE END ==== */
}
''', r'''#[derive(Clone)]
struct Process{pid:i32,arrival:i32,burst:i32,priority:i32,remaining:i32,wait:i32,turnaround:i32,done:bool}

fn fcfs(p:&mut Vec<Process>){let n=p.len();
    p.sort_by_key(|x|x.arrival);
    let(mut time,tw,tt)=(0,0.0,0.0);
    for i in 0..n{if time<p[i].arrival{time=p[i].arrival};p[i].wait=time-p[i].arrival;time+=p[i].burst;p[i].turnaround=time-p[i].arrival;tw+=p[i].wait as f64;tt+=p[i].turnaround as f64;}
    println!("FCFS: avg wait={:.1}, avg turnaround={:.1}",tw/n as f64,tt/n as f64);}
fn sjf(p:&mut Vec<Process>){let n=p.len();let(mut done,mut time,tw,tt)=(0,0,0.0,0.0);
    while done<n{let(mut best,mut mb)=(-1,i32::MAX);for i in 0..n{if!p[i].done&&p[i].arrival<=time&&p[i].burst<mb{best=i as i32;mb=p[i].burst;}}if best==-1{time+=1;continue;}let b=best as usize;p[b].wait=time-p[b].arrival;time+=p[b].burst;p[b].turnaround=time-p[b].arrival;tw+p[b].wait as f64;tt+p[b].turnaround as f64;p[b].done=true;done+=1;}
    println!("SJF:  avg wait={:.1}, avg turnaround={:.1}",tw/n as f64,tt/n as f64);}
fn rr(p:&mut Vec<Process>,q:i32){let n=p.len();let(mut done,mut time,tw,tt)=(0,0,0.0,0.0);
    while done<n{let mut run=false;for i in 0..n{if!p[i].done&&p[i].arrival<=time{let t=p[i].remaining.min(q);p[i].remaining-=t;time+=t;run=true;if p[i].remaining==0{p[i].done=true;done+=1;p[i].turnaround=time-p[i].arrival;p[i].wait=p[i].turnaround-p[i].burst;tw+=p[i].wait as f64;tt+=p[i].turnaround as f64;}}}if!run{time+=1;}}
    println!("RR:   avg wait={:.1}, avg turnaround={:.1}",tw/n as f64,tt/n as f64);}
fn priority_sched(p:&mut Vec<Process>){let n=p.len();let(mut done,mut time,tw,tt)=(0,0,0.0,0.0);
    while done<n{let(mut best,mut mp)=(-1,i32::MAX);for i in 0..n{if!p[i].done&&p[i].arrival<=time&&p[i].priority<mp{best=i as i32;mp=p[i].priority;}}if best==-1{time+=1;continue;}let b=best as usize;p[b].wait=time-p[b].arrival;time+=p[b].burst;p[b].turnaround=time-p[b].arrival;tw+=p[b].wait as f64;tt+=p[b].turnaround as f64;p[b].done=true;done+=1;}
    println!("Priority: avg wait={:.1}, avg turnaround={:.1}",tw/n as f64,tt/n as f64);}
fn main(){
    let mut p=vec![Process{pid:1,arrival:0,burst:8,priority:2,remaining:8,wait:0,turnaround:0,done:false},Process{pid:2,arrival:1,burst:4,priority:1,remaining:4,wait:0,turnaround:0,done:false},Process{pid:3,arrival:2,burst:9,priority:3,remaining:9,wait:0,turnaround:0,done:false},Process{pid:4,arrival:3,burst:5,priority:2,remaining:5,wait:0,turnaround:0,done:false}];
    fcfs(&mut p);sjf(&mut p);rr(&mut p,2);priority_sched(&mut p);
    println!("Scheduler simulation complete");
}
''')
print('lab24 done')
