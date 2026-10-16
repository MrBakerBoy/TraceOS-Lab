#!/usr/bin/env python3
import subprocess
def get_exp_id(name):
    r = subprocess.run(['docker','exec','-i','traceos-postgres','psql','-U','traceos','-d','traceos','-t','-A','-c',f"SELECT id FROM experiments WHERE name='{name}'"], capture_output=True, text=True)
    return r.stdout.strip()
def esc(s): return "'" + s.replace("'","''") + "'" if s else 'NULL'
def upsert(n,l,s,r):
    eid=get_exp_id(n)
    if not eid: print(f'  SKIP {n}'); return
    sql=f"INSERT INTO experiment_code_templates (experiment_id,language,starter_code,reference_solution,is_published,updated_at) VALUES ('{eid}','{l}',{esc(s)},{esc(r)},true,NOW()) ON CONFLICT (experiment_id,language) DO UPDATE SET starter_code=EXCLUDED.starter_code,reference_solution=EXCLUDED.reference_solution,updated_at=NOW();"
    r2=subprocess.run(['docker','exec','-i','traceos-postgres','psql','-U','traceos','-d','traceos','-c',sql],capture_output=True,text=True)
    print(f'  {"OK" if r2.returncode==0 else "ERR"} {n}/{l}')

# ==================== lab25_mlfq ====================
upsert('lab25_mlfq','cpp',r'''#include <cstdio>
#include <cstring>

/**
 * 多级反馈队列调度实验 (MLFQ)
 * 目标：实现3级反馈队列，理解MLFQ规则
 * 提示：
 *   - 3个队列：Q0(时间片2), Q1(时间片4), Q2(FCFS)
 *   - 新进程进入Q0
 *   - 用完时间片未完成→降级
 *   - 高优先级队列有进程时不调度低优先级
 *   - 每10时间单位做一次优先级提升（所有进程回Q0）
 */
#define MAX_PROC 10
#define Q0_TIME 2
#define Q1_TIME 4
#define BOOST_INTERVAL 10

struct Proc { int pid,arrival,burst,remaining,queue,done,wait,turnaround; };
Proc procs[MAX_PROC];
int n;

/* ==== CODE START ==== */
void mlfq_simulate() {
    // TODO: 实现MLFQ调度模拟
    //  初始化所有进程的remaining=burst, queue=0
    //  循环直到所有进程完成
    //  每次选择最高优先级队列中已到达且最前面的进程
    //  用完时间片降级
    //  每BOOST_INTERVAL优先级提升
    //  输出时间线 "Time X: PY"
    //  最终输出统计 "MLFQ: avg wait=X, avg turnaround=Y"
    //  输出 "Priority boosts: N"
}
/* ==== CODE END ==== */

int main() {
    procs[0]={1,0,12}; procs[1]={2,2,6}; procs[2]={3,4,4}; procs[3]={4,8,8}; n=4;
    /* ==== CODE START ==== */
    mlfq_simulate();
    /* ==== CODE END ==== */
    return 0;
}
''',r'''#include <cstdio>
#include <cstring>
#define MAX_PROC 10
#define Q0_TIME 2
#define Q1_TIME 4
#define BOOST_INTERVAL 10
struct Proc{int pid,arrival,burst,remaining,queue,done,wait,turnaround;};
Proc procs[MAX_PROC]; int n;
void mlfq_simulate(){
    for(int i=0;i<n;i++){procs[i].remaining=procs[i].burst;procs[i].queue=0;procs[i].done=0;}
    int time=0,done=0,boosts=0; double tw=0,tt=0;
    while(done<n){
        int best=-1,bq=3;
        for(int i=0;i<n;i++) if(!procs[i].done&&procs[i].arrival<=time&&procs[i].queue<bq){best=i;bq=procs[i].queue;}
        if(best==-1){time++;continue;}
        int slice=(bq==0)?Q0_TIME:((bq==1)?Q1_TIME:procs[best].remaining);
        int rt=procs[best].remaining<slice?procs[best].remaining:slice;
        printf("Time %d: P%d\n",time,procs[best].pid);
        procs[best].remaining-=rt;time+=rt;
        if(procs[best].remaining==0){procs[best].done=1;done++;procs[best].turnaround=time-procs[best].arrival;procs[best].wait=procs[best].turnaround-procs[best].burst;tw+=procs[best].wait;tt+=procs[best].turnaround;}
        else if(bq<2)procs[best].queue++;
        if(time%BOOST_INTERVAL==0||((time/BOOST_INTERVAL)*BOOST_INTERVAL!=((time-rt)/BOOST_INTERVAL)*BOOST_INTERVAL)){for(int i=0;i<n;i++)if(!procs[i].done)procs[i].queue=0;boosts++;}
    }
    printf("MLFQ: avg wait=%.1f, avg turnaround=%.1f\n",tw/n,tt/n);
    printf("Priority boosts: %d\n",boosts);
}
int main(){procs[0]={1,0,12};procs[1]={2,2,6};procs[2]={3,4,4};procs[3]={4,8,8};n=4;mlfq_simulate();return 0;}
''')

upsert('lab25_mlfq','python',r'''#!/usr/bin/env python3
"""
多级反馈队列调度实验 (MLFQ)
目标：实现3级反馈队列，理解MLFQ规则
提示：
  - 3个队列：Q0(时间片2), Q1(时间片4), Q2(FCFS)
  - 新进程进入Q0，用完时间片未完成→降级
  - 每10时间单位做一次优先级提升
"""
Q0_TIME=2; Q1_TIME=4; BOOST_INTERVAL=10

class Proc:
    def __init__(self,pid,arrival,burst):
        self.pid=pid;self.arrival=arrival;self.burst=burst
        self.remaining=burst;self.queue=0;self.done=False
        self.wait=0;self.turnaround=0

def mlfq_simulate(procs):
    # ==== CODE START ====
    # TODO: 实现MLFQ调度模拟
    #  输出时间线 "Time X: PY"
    #  最终输出 "MLFQ: avg wait=X, avg turnaround=Y"
    #  输出 "Priority boosts: N"
    # ==== CODE END ====
    pass

if __name__=='__main__':
    procs=[Proc(1,0,12),Proc(2,2,6),Proc(3,4,4),Proc(4,8,8)]
    mlfq_simulate(procs)
''',r'''#!/usr/bin/env python3
Q0_TIME=2;Q1_TIME=4;BOOST_INTERVAL=10
class Proc:
    def __init__(s,p,a,b):s.pid=p;s.arrival=a;s.burst=b;s.remaining=b;s.queue=0;s.done=False;s.wait=0;s.turnaround=0
def mlfq_simulate(procs):
    time=0;done=0;boosts=0;tw=0.0;tt=0.0;n=len(procs)
    while done<n:
        best=-1;bq=3
        for i in range(n):
            if not procs[i].done and procs[i].arrival<=time and procs[i].queue<bq: best=i;bq=procs[i].queue
        if best==-1: time+=1;continue
        slice_=Q0_TIME if bq==0 else (Q1_TIME if bq==1 else procs[best].remaining)
        rt=min(procs[best].remaining,slice_)
        print("Time %d: P%d"%(time,procs[best].pid))
        procs[best].remaining-=rt;time+=rt
        if procs[best].remaining==0:
            procs[best].done=True;done+=1
            procs[best].turnaround=time-procs[best].arrival
            procs[best].wait=procs[best].turnaround-procs[best].burst
            tw+=procs[best].wait;tt+=procs[best].turnaround
        elif bq<2: procs[best].queue+=1
        if time%BOOST_INTERVAL==0 or (time//BOOST_INTERVAL)*BOOST_INTERVAL!=((time-rt)//BOOST_INTERVAL)*BOOST_INTERVAL:
            for i in range(n):
                if not procs[i].done: procs[i].queue=0
            boosts+=1
    print("MLFQ: avg wait=%.1f, avg turnaround=%.1f"%(tw/n,tt/n))
    print("Priority boosts: %d"%boosts)
if __name__=='__main__':
    procs=[Proc(1,0,12),Proc(2,2,6),Proc(3,4,4),Proc(4,8,8)]
    mlfq_simulate(procs)
''')

upsert('lab25_mlfq','go',r'''package main
import "fmt"
const Q0_TIME=2;const Q1_TIME=4;const BOOST_INTERVAL=10
type Proc struct{pid,arrival,burst,remaining,queue,done,wait,turnaround int}
func mlfqSimulate(procs []Proc){
    /* ==== CODE START ==== */
    // TODO: 实现MLFQ调度模拟
    /* ==== CODE END ==== */
}
func main(){
    procs:=[]Proc{{1,0,12,12,0,0,0,0},{2,2,6,6,0,0,0,0},{3,4,4,4,0,0,0,0},{4,8,8,8,0,0,0,0}}
    /* ==== CODE START ==== */mlfqSimulate(procs)/* ==== CODE END ==== */
}
''',r'''package main
import "fmt"
const Q0_TIME=2;const Q1_TIME=4;const BOOST_INTERVAL=10
type Proc struct{pid,arrival,burst,remaining,queue,done,wait,turnaround int}
func mlfqSimulate(procs []Proc){n:=len(procs);done,time,boosts:=0,0,0;tw,tt:=0.0,0.0
    for done<n{best,bq:=-1,3
        for i:=0;i<n;i++{if procs[i].done==0&&procs[i].arrival<=time&&procs[i].queue<bq{best,bq=i,procs[i].queue}}
        if best==-1{time++;continue}
        slice:=Q0_TIME;if bq==1{slice=Q1_TIME}else if bq==2{slice=procs[best].remaining}
        rt:=procs[best].remaining;if rt>slice{rt=slice}
        fmt.Printf("Time %d: P%d\n",time,procs[best].pid)
        procs[best].remaining-=rt;time+=rt
        if procs[best].remaining==0{procs[best].done=1;done++;procs[best].turnaround=time-procs[best].arrival;procs[best].wait=procs[best].turnaround-procs[best].burst;tw+=float64(procs[best].wait);tt+=float64(procs[best].turnaround)}else if bq<2{procs[best].queue++}
        if time%BOOST_INTERVAL==0||(time/BOOST_INTERVAL)*BOOST_INTERVAL!=((time-rt)/BOOST_INTERVAL)*BOOST_INTERVAL{for i:=0;i<n;i++{if procs[i].done==0{procs[i].queue=0}};boosts++}
    }
    fmt.Printf("MLFQ: avg wait=%.1f, avg turnaround=%.1f\n",tw/float64(n),tt/float64(n))
    fmt.Printf("Priority boosts: %d\n",boosts)
}
func main(){procs:=[]Proc{{1,0,12,12,0,0,0,0},{2,2,6,6,0,0,0,0},{3,4,4,4,0,0,0,0},{4,8,8,8,0,0,0,0}};mlfqSimulate(procs)}
''')

upsert('lab25_mlfq','rust',r'''/*
 * 多级反馈队列调度实验 (MLFQ)
 * 目标：实现3级反馈队列，理解MLFQ规则
 */
const Q0_TIME:i32=2;const Q1_TIME:i32=4;const BOOST_INTERVAL:i32=10;
#[derive(Clone)]
struct Proc{pid:i32,arrival:i32,burst:i32,remaining:i32,queue:i32,done:bool,wait:i32,turnaround:i32}
fn mlfq_simulate(procs:&mut Vec<Proc>){
    /* ==== CODE START ==== */
    // TODO: 实现MLFQ调度模拟
    /* ==== CODE END ==== */
}
fn main(){
    let mut procs=vec![Proc{pid:1,arrival:0,burst:12,remaining:12,queue:0,done:false,wait:0,turnaround:0},Proc{pid:2,arrival:2,burst:6,remaining:6,queue:0,done:false,wait:0,turnaround:0},Proc{pid:3,arrival:4,burst:4,remaining:4,queue:0,done:false,wait:0,turnaround:0},Proc{pid:4,arrival:8,burst:8,remaining:8,queue:0,done:false,wait:0,turnaround:0}];
    /* ==== CODE START ==== */mlfq_simulate(&mut procs);/* ==== CODE END ==== */
}
''',r'''const Q0_TIME:i32=2;const Q1_TIME:i32=4;const BOOST_INTERVAL:i32=10;
#[derive(Clone)]
struct Proc{pid:i32,arrival:i32,burst:i32,remaining:i32,queue:i32,done:bool,wait:i32,turnaround:i32}
fn mlfq_simulate(procs:&mut Vec<Proc>){let n=procs.len();let(mut done,mut time,mut boosts,mut tw,mut tt)=(0,0,0,0.0,0.0);
    while done<n{let(mut best,mut bq)=(-1,3);
        for i in 0..n{if!procs[i].done&&procs[i].arrival<=time&&procs[i].queue<bq{best=i as i32;bq=procs[i].queue;}}
        if best==-1{time+=1;continue;}
        let b=best as usize;let mut slice=Q0_TIME;if bq==1{slice=Q1_TIME}else if bq==2{slice=procs[b].remaining;}
        let mut rt=procs[b].remaining;if rt>slice{rt=slice;}
        println!("Time {}: P{}",time,procs[b].pid);
        procs[b].remaining-=rt;time+=rt;
        if procs[b].remaining==0{procs[b].done=true;done+=1;procs[b].turnaround=time-procs[b].arrival;procs[b].wait=procs[b].turnaround-procs[b].burst;tw+=procs[b].wait as f64;tt+=procs[b].turnaround as f64;}else if bq<2{procs[b].queue+=1;}
        if time%BOOST_INTERVAL==0||(time/BOOST_INTERVAL)*BOOST_INTERVAL!=((time-rt)/BOOST_INTERVAL)*BOOST_INTERVAL{for i in 0..n{if!procs[i].done{procs[i].queue=0;}}boosts+=1;}
    }
    println!("MLFQ: avg wait={:.1}, avg turnaround={:.1}",tw/n as f64,tt/n as f64);
    println!("Priority boosts: {}",boosts);
}
fn main(){let mut procs=vec![Proc{pid:1,arrival:0,burst:12,remaining:12,queue:0,done:false,wait:0,turnaround:0},Proc{pid:2,arrival:2,burst:6,remaining:6,queue:0,done:false,wait:0,turnaround:0},Proc{pid:3,arrival:4,burst:4,remaining:4,queue:0,done:false,wait:0,turnaround:0},Proc{pid:4,arrival:8,burst:8,remaining:8,queue:0,done:false,wait:0,turnaround:0}];mlfq_simulate(&mut procs);}
''')

# ==================== lab26_real_time ====================
upsert('lab26_real_time','cpp',r'''#include <cstdio>
#include <cmath>

/**
 * 实时调度实验：EDF与RMS
 * 目标：实现RMS和EDF实时调度算法，验证可调度性
 * 提示：
 *   - RMS: Rate Monotonic Scheduling（周期越小优先级越高）
 *   - RMS可调度性判定：U <= n*(2^(1/n)-1) Liu-Layland bound
 *   - EDF: Earliest Deadline First（最早截止时间优先）
 *   - EDF可调度性判定：U <= 1.0
 *   - U = SUM(exec_i / period_i)
 */
struct Task { int period, exec, remaining, next_deadline; };

double calc_utilization(Task tasks[], int n) {
    /* ==== CODE START ==== */
    // TODO: 计算CPU利用率 U
    /* ==== CODE END ==== */
    return 0;
}
int rms_check(Task tasks[], int n) {
    /* ==== CODE START ==== */
    // TODO: 验证RMS可调度性，输出 "RMS: U=X%, bound=Y%, schedulable=YES/NO"
    /* ==== CODE END ==== */
    return 0;
}
int edf_check(Task tasks[], int n) {
    /* ==== CODE START ==== */
    // TODO: 验证EDF可调度性（U <= 100%），输出 "EDF: U=X%, bound=100%, schedulable=YES/NO"
    /* ==== CODE END ==== */
    return 0;
}

int main() {
    Task tasks[] = {{4,1},{5,2},{20,5}};
    int n = 3;
    /* ==== CODE START ==== */
    // TODO: 分别用RMS和EDF分析，模拟20个时间单位
    //  最终输出 "Real-time scheduling analysis complete"
    /* ==== CODE END ==== */
    return 0;
}
''',r'''#include <cstdio>
#include <cmath>
struct Task{int period,exec,remaining,next_deadline;};
double calc_utilization(Task t[],int n){double u=0;for(int i=0;i<n;i++)u+=(double)t[i].exec/t[i].period;return u;}
int rms_check(Task t[],int n){double u=calc_utilization(t,n)*100;double bound=n*(pow(2.0,1.0/n)-1)*100;printf("RMS: U=%.0f%%, bound=%.0f%%, schedulable=%s\n",u,bound,u<=bound?"YES":"NO");return u<=bound;}
int edf_check(Task t[],int n){double u=calc_utilization(t,n)*100;printf("EDF: U=%.0f%%, bound=100%%, schedulable=%s\n",u,u<=100?"YES":"NO");return u<=100;}
int main(){Task tasks[]={{4,1,1,4},{5,2,2,5},{20,5,5,20}};int n=3;
    rms_check(tasks,n);edf_check(tasks,n);
    for(int time=0;time<20;time++){int best=-1,earliest=999;for(int i=0;i<n;i++)if(tasks[i].remaining>0&&tasks[i].next_deadline<earliest){best=i;earliest=tasks[i].next_deadline;}if(best>=0){printf("Time %d: T%d\n",time,best+1);tasks[best].remaining--;if(tasks[best].remaining==0){tasks[best].remaining=tasks[best].exec;tasks[best].next_deadline+=tasks[best].period;}}}
    printf("Real-time scheduling analysis complete\n");return 0;}
''')

upsert('lab26_real_time','python',r'''#!/usr/bin/env python3
"""
实时调度实验：EDF与RMS
目标：实现RMS和EDF实时调度算法，验证可调度性
"""
import math
class Task:
    def __init__(s,period,exec_):s.period=period;s.exec=exec_;s.remaining=exec_;s.next_deadline=period
def calc_utilization(tasks):
    # ==== CODE START ====
    # TODO: 计算CPU利用率 U
    # ==== CODE END ====
    return 0
def rms_check(tasks):
    # ==== CODE START ====
    # TODO: 验证RMS可调度性，输出 "RMS: U=X%, bound=Y%, schedulable=YES/NO"
    # ==== CODE END ====
    return False
def edf_check(tasks):
    # ==== CODE START ====
    # TODO: 验证EDF可调度性
    # ==== CODE END ====
    return False
if __name__=='__main__':
    tasks=[Task(4,1),Task(5,2),Task(20,5)]
    # ==== CODE START ====
    # TODO: 分别用RMS和EDF分析，模拟20个时间单位
    #  最终输出 "Real-time scheduling analysis complete"
    # ==== CODE END ====
    pass
''',r'''#!/usr/bin/env python3
import math
class Task:
    def __init__(s,period,exec_):s.period=period;s.exec=exec_;s.remaining=exec_;s.next_deadline=period
def calc_utilization(tasks):
    return sum(t.exec/t.period for t in tasks)
def rms_check(tasks):
    n=len(tasks);u=calc_utilization(tasks)*100;bound=n*(2**(1.0/n)-1)*100
    print("RMS: U=%.0f%%, bound=%.0f%%, schedulable=%s"%(u,bound,"YES" if u<=bound else "NO"))
    return u<=bound
def edf_check(tasks):
    u=calc_utilization(tasks)*100
    print("EDF: U=%.0f%%, bound=100%%, schedulable=%s"%(u,"YES" if u<=100 else "NO"))
    return u<=100
if __name__=='__main__':
    tasks=[Task(4,1),Task(5,2),Task(20,5)]
    rms_check(tasks);edf_check(tasks)
    for time in range(20):
        best=-1;earliest=999
        for i in range(len(tasks)):
            if tasks[i].remaining>0 and tasks[i].next_deadline<earliest: best=i;earliest=tasks[i].next_deadline
        if best>=0:
            print("Time %d: T%d"%(time,best+1))
            tasks[best].remaining-=1
            if tasks[best].remaining==0:
                tasks[best].remaining=tasks[best].exec
                tasks[best].next_deadline+=tasks[best].period
    print("Real-time scheduling analysis complete")
''')

upsert('lab26_real_time','go',r'''package main
import ("fmt";"math")
type Task struct{period,exec_,remaining,nextDeadline int}
func calcUtilization(t []Task)float64{
    /* ==== CODE START ==== */ // TODO: 计算CPU利用率 /* ==== CODE END ==== */
    return 0
}
func rmsCheck(t []Task)bool{
    /* ==== CODE START ==== */ // TODO: 验证RMS可调度性 /* ==== CODE END ==== */
    return false
}
func edfCheck(t []Task)bool{
    /* ==== CODE START ==== */ // TODO: 验证EDF可调度性 /* ==== CODE END ==== */
    return false
}
func main(){
    tasks:=[]Task{{4,1,1,4},{5,2,2,5},{20,5,5,20}}
    /* ==== CODE START ==== */ // TODO: 分析并模拟 /* ==== CODE END ==== */
}
''',r'''package main
import ("fmt";"math")
type Task struct{period,exec_,remaining,nextDeadline int}
func calcUtilization(t []Task)float64{u:=0.0;for _,x:=range t{u+=float64(x.exec_)/float64(x.period)};return u}
func rmsCheck(t []Task)bool{n:=len(t);u:=calcUtilization(t)*100;bound:=float64(n)*(math.Pow(2,1.0/float64(n))-1)*100;fmt.Printf("RMS: U=%.0f%%, bound=%.0f%%, schedulable=%s\n",u,bound,ifS(u<=bound));return u<=bound}
func edfCheck(t []Task)bool{u:=calcUtilization(t)*100;fmt.Printf("EDF: U=%.0f%%, bound=100%%, schedulable=%s\n",u,ifS(u<=100));return u<=100}
func ifS(b bool)string{if b{return "YES"};return "NO"}
func main(){
    tasks:=[]Task{{4,1,1,4},{5,2,2,5},{20,5,5,20}}
    rmsCheck(tasks);edfCheck(tasks)
    for time:=0;time<20;time++{best,earliest:=-1,999;for i:=range tasks{if tasks[i].remaining>0&&tasks[i].nextDeadline<earliest{best,earliest=i,tasks[i].nextDeadline}};if best>=0{fmt.Printf("Time %d: T%d\n",time,best+1);tasks[best].remaining--;if tasks[best].remaining==0{tasks[best].remaining=tasks[best].exec_;tasks[best].nextDeadline+=tasks[best].period}}}
    fmt.Println("Real-time scheduling analysis complete")
}
''')

upsert('lab26_real_time','rust',r'''/*
 * 实时调度实验：EDF与RMS
 * 目标：实现RMS和EDF实时调度算法，验证可调度性
 */
#[derive(Clone)]
struct Task{period:i32,exec_:i32,remaining:i32,next_deadline:i32}
fn calc_utilization(t:&[Task])->f64{
    /* ==== CODE START ==== */ // TODO: 计算CPU利用率 /* ==== CODE END ==== */
    0.0
}
fn rms_check(t:&[Task])->bool{
    /* ==== CODE START ==== */ // TODO: 验证RMS可调度性 /* ==== CODE END ==== */
    false
}
fn edf_check(t:&[Task])->bool{
    /* ==== CODE START ==== */ // TODO: 验证EDF可调度性 /* ==== CODE END ==== */
    false
}
fn main(){
    let mut tasks=vec![Task{period:4,exec_:1,remaining:1,next_deadline:4},Task{period:5,exec_:2,remaining:2,next_deadline:5},Task{period:20,exec_:5,remaining:5,next_deadline:20}];
    /* ==== CODE START ==== */ // TODO: 分析并模拟 /* ==== CODE END ==== */
}
''',r'''#[derive(Clone)]
struct Task{period:i32,exec_:i32,remaining:i32,next_deadline:i32}
fn calc_utilization(t:&[Task])->f64{let mut u=0.0;for x in t{u+=x.exec_ as f64/x.period as f64;}u}
fn rms_check(t:&[Task])->bool{let n=t.len();let u=calc_utilization(t)*100.0;let bound=n as f64*(2f64.powf(1.0/n as f64)-1.0)*100.0;let s=if u<=bound{"YES"}else{"NO"};println!("RMS: U={:.0}%, bound={:.0}%, schedulable={}",u,bound,s);u<=bound}
fn edf_check(t:&[Task])->bool{let u=calc_utilization(t)*100.0;let s=if u<=100.0{"YES"}else{"NO"};println!("EDF: U={:.0}%, bound=100%, schedulable={}",u,s);u<=100.0}
fn main(){
    let mut tasks=vec![Task{period:4,exec_:1,remaining:1,next_deadline:4},Task{period:5,exec_:2,remaining:2,next_deadline:5},Task{period:20,exec_:5,remaining:5,next_deadline:20}];
    rms_check(&tasks);edf_check(&tasks);
    for time in 0..20{let(mut best,mut earliest)=(-1,999);for i in 0..tasks.len(){if tasks[i].remaining>0&&tasks[i].next_deadline<earliest{best=i as i32;earliest=tasks[i].next_deadline;}}if best>=0{let b=best as usize;println!("Time {}: T{}",time,b+1);tasks[b].remaining-=1;if tasks[b].remaining==0{tasks[b].remaining=tasks[b].exec_;tasks[b].next_deadline+=tasks[b].period;}}}
    println!("Real-time scheduling analysis complete");
}
''')
print('lab25-lab26 done')
