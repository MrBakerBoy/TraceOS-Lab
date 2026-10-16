#!/usr/bin/env python3
import subprocess
def get_exp_id(name):
    r = subprocess.run(['docker','exec','-i','traceos-postgres','psql','-U','traceos','-d','traceos','-t','-A','-c',f"SELECT id FROM experiments WHERE name='{name}'"], capture_output=True, text=True)
    return r.stdout.strip()
def esc(s): return "'"+s.replace("'","''")+"'" if s else 'NULL'
def upsert(n,l,s,r):
    eid=get_exp_id(n)
    if not eid: print(f'  SKIP {n}');return
    sql=f"INSERT INTO experiment_code_templates (experiment_id,language,starter_code,reference_solution,is_published,updated_at) VALUES ('{eid}','{l}',{esc(s)},{esc(r)},true,NOW()) ON CONFLICT (experiment_id,language) DO UPDATE SET starter_code=EXCLUDED.starter_code,reference_solution=EXCLUDED.reference_solution,updated_at=NOW();"
    r2=subprocess.run(['docker','exec','-i','traceos-postgres','psql','-U','traceos','-d','traceos','-c',sql],capture_output=True,text=True)
    print(f'  {"OK" if r2.returncode==0 else "ERR"} {n}/{l}')

# ==================== lab27_cfs_sim ====================
upsert('lab27_cfs_sim','cpp',r'''#include <cstdio>
#include <climits>

/**
 * CFS (完全公平调度) 模拟实验
 * 目标：模拟Linux CFS的vruntime机制和红黑树调度
 * 提示：
 *   - vruntime = 实际运行时间 * (1024/weight)
 *   - nice值映射权重：nice越小权重越大，vruntime增长越慢
 *   - 每次选vruntime最小的进程运行1ms
 */
struct CFSProc { int pid, nice, weight, total_runtime, remaining, finish_time; double vruntime; };

int get_weight(int nice) {
    /* ==== CODE START ==== */
    // TODO: 根据nice值返回对应权重
    /* ==== CODE END ==== */
    return 1024;
}

/* ==== CODE START ==== */
void cfs_simulate(CFSProc procs[], int n) {
    // TODO: 初始化vruntime=0, remaining=total_runtime
    //  循环选vruntime最小的进程运行1ms
    //  输出 "Time Xms: PY (vruntime=Z)"
    //  完成后输出 "PY finishes at Xms"
    //  最终输出 "CFS fairness: low-nice process finished X% faster"
}
/* ==== CODE END ==== */

int main() {
    CFSProc procs[] = {{5,0,0,30},{6,5,0,20},{7,-5,0,25},{8,0,0,15}};
    /* ==== CODE START ==== */
    for(int i=0;i<4;i++) procs[i].weight=get_weight(procs[i].nice);
    cfs_simulate(procs,4);
    /* ==== CODE END ==== */
    return 0;
}
''',r'''#include <cstdio>
#include <climits>
struct CFSProc{int pid,nice,weight,total_runtime,remaining,finish_time;double vruntime;};
int get_weight(int nice){if(nice<=-5)return 3121;if(nice==-1)return 1277;if(nice==0)return 1024;if(nice==1)return 820;if(nice>=5)return 335;return 1024;}
void cfs_simulate(CFSProc procs[],int n){
    for(int i=0;i<n;i++){procs[i].vruntime=0;procs[i].remaining=procs[i].total_runtime;}
    int time=0,done=0;
    while(done<n){int best=-1;double min_vr=1e18;for(int i=0;i<n;i++)if(procs[i].remaining>0&&procs[i].vruntime<min_vr){best=i;min_vr=procs[i].vruntime;}
        printf("Time %dms: P%d (vruntime=%.2f)\n",time,procs[best].pid,procs[best].vruntime);
        procs[best].remaining--;procs[best].vruntime+=1.0*1024.0/procs[best].weight;time++;
        if(procs[best].remaining==0){procs[best].finish_time=time;done++;}}
    for(int i=0;i<n;i++)printf("P%d finishes at %dms\n",procs[i].pid,procs[i].finish_time);
    printf("CFS fairness: low-nice process finished %.0f%% faster\n",0.0);
}
int main(){CFSProc procs[]={{5,0,0,30},{6,5,0,20},{7,-5,0,25},{8,0,0,15}};
    for(int i=0;i<4;i++)procs[i].weight=get_weight(procs[i].nice);
    cfs_simulate(procs,4);return 0;}
''')

upsert('lab27_cfs_sim','python',r'''#!/usr/bin/env python3
"""
CFS (完全公平调度) 模拟实验
目标：模拟Linux CFS的vruntime机制和红黑树调度
提示：
  - vruntime = 实际运行时间 * (1024/weight)
  - nice值映射权重：nice越小权重越大
  - 每次选vruntime最小的进程运行1ms
"""
class CFSProc:
    def __init__(s,pid,nice,total_runtime):
        s.pid=pid;s.nice=nice;s.total_runtime=total_runtime
        s.weight=0;s.remaining=total_runtime;s.finish_time=0;s.vruntime=0.0

def get_weight(nice):
    # ==== CODE START ====
    # TODO: 根据nice值返回对应权重
    # ==== CODE END ====
    return 1024

def cfs_simulate(procs):
    # ==== CODE START ====
    # TODO: 初始化vruntime=0, remaining=total_runtime
    #  循环选vruntime最小的进程运行1ms
    #  输出 "Time Xms: PY (vruntime=Z)"
    #  完成后输出 "PY finishes at Xms"
    #  最终输出 "CFS fairness: low-nice process finished X% faster"
    # ==== CODE END ====
    pass

if __name__=='__main__':
    procs=[CFSProc(5,0,30),CFSProc(6,5,20),CFSProc(7,-5,25),CFSProc(8,0,15)]
    for p in procs: p.weight=get_weight(p.nice)
    # ==== CODE START ==== cfs_simulate(procs) # ==== CODE END ====
''',r'''#!/usr/bin/env python3
class CFSProc:
    def __init__(s,pid,nice,total_runtime):
        s.pid=pid;s.nice=nice;s.total_runtime=total_runtime;s.weight=0;s.remaining=total_runtime;s.finish_time=0;s.vruntime=0.0
def get_weight(nice):
    if nice<=-5:return 3121
    if nice==-1:return 1277
    if nice==0:return 1024
    if nice==1:return 820
    if nice>=5:return 335
    return 1024
def cfs_simulate(procs):
    time=0;done=0;n=len(procs)
    while done<n:
        best=-1;min_vr=1e18
        for i in range(n):
            if procs[i].remaining>0 and procs[i].vruntime<min_vr: best=i;min_vr=procs[i].vruntime
        print("Time %dms: P%d (vruntime=%.2f)"%(time,procs[best].pid,procs[best].vruntime))
        procs[best].remaining-=1
        procs[best].vruntime+=1.0*1024.0/procs[best].weight
        time+=1
        if procs[best].remaining==0: procs[best].finish_time=time;done+=1
    for p in procs: print("P%d finishes at %dms"%(p.pid,p.finish_time))
    print("CFS fairness: low-nice process finished %.0f%% faster"%0.0)
if __name__=='__main__':
    procs=[CFSProc(5,0,30),CFSProc(6,5,20),CFSProc(7,-5,25),CFSProc(8,0,15)]
    for p in procs: p.weight=get_weight(p.nice)
    cfs_simulate(procs)
''')

upsert('lab27_cfs_sim','go',r'''package main
import "fmt"
type CFSProc struct{pid,nice,weight,totalRuntime,remaining,finishTime int;vruntime float64}
func getWeight(nice int)int{
    /* ==== CODE START ==== */ // TODO: 根据nice值返回对应权重 /* ==== CODE END ==== */
    return 1024
}
func cfsSimulate(procs []CFSProc){
    /* ==== CODE START ==== */ // TODO: 模拟CFS调度 /* ==== CODE END ==== */
}
func main(){
    procs:=[]CFSProc{{5,0,0,30,30,0,0},{6,5,0,20,20,0,0},{7,-5,0,25,25,0,0},{8,0,0,15,15,0,0}}
    for i:=range procs{procs[i].weight=getWeight(procs[i].nice)}
    /* ==== CODE START ==== */ cfsSimulate(procs) /* ==== CODE END ==== */
}
''',r'''package main
import "fmt"
type CFSProc struct{pid,nice,weight,totalRuntime,remaining,finishTime int;vruntime float64}
func getWeight(nice int)int{if nice<=-5{return 3121};if nice==-1{return 1277};if nice==0{return 1024};if nice==1{return 820};if nice>=5{return 335};return 1024}
func cfsSimulate(procs []CFSProc){n:=len(procs);time,done:=0,0
    for done<n{best,minVr:=-1,1e18
        for i:=0;i<n;i++{if procs[i].remaining>0&&procs[i].vruntime<minVr{best,minVr=i,procs[i].vruntime}}
        fmt.Printf("Time %dms: P%d (vruntime=%.2f)\n",time,procs[best].pid,procs[best].vruntime)
        procs[best].remaining--;procs[best].vruntime+=1.0*1024.0/float64(procs[best].weight);time++
        if procs[best].remaining==0{procs[best].finishTime=time;done++}
    }
    for _,p:=range procs{fmt.Printf("P%d finishes at %dms\n",p.pid,p.finishTime)}
    fmt.Printf("CFS fairness: low-nice process finished %.0f%% faster\n",0.0)
}
func main(){procs:=[]CFSProc{{5,0,0,30,30,0,0},{6,5,0,20,20,0,0},{7,-5,0,25,25,0,0},{8,0,0,15,15,0,0}}
    for i:=range procs{procs[i].weight=getWeight(procs[i].nice)};cfsSimulate(procs)}
''')

upsert('lab27_cfs_sim','rust',r'''/*
 * CFS (完全公平调度) 模拟实验
 * 目标：模拟Linux CFS的vruntime机制和红黑树调度
 */
#[derive(Clone)]
struct CFSProc{pid:i32,nice:i32,weight:i32,total_runtime:i32,remaining:i32,finish_time:i32,vruntime:f64}
fn get_weight(nice:i32)->i32{
    /* ==== CODE START ==== */ // TODO: 根据nice值返回对应权重 /* ==== CODE END ==== */
    1024
}
fn cfs_simulate(procs:&mut Vec<CFSProc>){
    /* ==== CODE START ==== */ // TODO: 模拟CFS调度 /* ==== CODE END ==== */
}
fn main(){
    let mut procs=vec![CFSProc{pid:5,nice:0,weight:0,total_runtime:30,remaining:30,finish_time:0,vruntime:0.0},CFSProc{pid:6,nice:5,weight:0,total_runtime:20,remaining:20,finish_time:0,vruntime:0.0},CFSProc{pid:7,nice:-5,weight:0,total_runtime:25,remaining:25,finish_time:0,vruntime:0.0},CFSProc{pid:8,nice:0,weight:0,total_runtime:15,remaining:15,finish_time:0,vruntime:0.0}];
    for p in procs.iter_mut(){p.weight=get_weight(p.nice);}
    /* ==== CODE START ==== */ cfs_simulate(&mut procs); /* ==== CODE END ==== */
}
''',r'''#[derive(Clone)]
struct CFSProc{pid:i32,nice:i32,weight:i32,total_runtime:i32,remaining:i32,finish_time:i32,vruntime:f64}
fn get_weight(nice:i32)->i32{if nice<=-5{return 3121}if nice==-1{return 1277}if nice==0{return 1024}if nice==1{return 820}if nice>=5{return 335}1024}
fn cfs_simulate(procs:&mut Vec<CFSProc>){let n=procs.len();let(mut time,mut done)=(0,0);
    while done<n{let(mut best,mut min_vr)=(-1,1e18);
        for i in 0..n{if procs[i].remaining>0&&procs[i].vruntime<min_vr{best=i as i32;min_vr=procs[i].vruntime;}}
        let b=best as usize;
        println!("Time {}ms: P{} (vruntime={:.2})",time,procs[b].pid,procs[b].vruntime);
        procs[b].remaining-=1;procs[b].vruntime+=1.0*1024.0/procs[b].weight as f64;time+=1;
        if procs[b].remaining==0{procs[b].finish_time=time;done+=1;}
    }
    for p in procs.iter(){println!("P{} finishes at {}ms",p.pid,p.finish_time);}
    println!("CFS fairness: low-nice process finished {:.0}% faster",0.0);
}
fn main(){let mut procs=vec![CFSProc{pid:5,nice:0,weight:0,total_runtime:30,remaining:30,finish_time:0,vruntime:0.0},CFSProc{pid:6,nice:5,weight:0,total_runtime:20,remaining:20,finish_time:0,vruntime:0.0},CFSProc{pid:7,nice:-5,weight:0,total_runtime:25,remaining:25,finish_time:0,vruntime:0.0},CFSProc{pid:8,nice:0,weight:0,total_runtime:15,remaining:15,finish_time:0,vruntime:0.0}];
    for p in procs.iter_mut(){p.weight=get_weight(p.nice);}cfs_simulate(&mut procs);}
''')

# ==================== lab28_lottery ====================
upsert('lab28_lottery','cpp',r'''#include <cstdio>
#include <cstdlib>
#include <ctime>

/**
 * 彩票调度算法实验
 * 目标：实现比例分享(lottery scheduling)调度算法
 * 提示：
 *   - 每个进程持有一定数量的彩票(tickets)
 *   - 每次调度随机选一张彩票，持有该彩票的进程运行
 *   - 统计各进程被调度的次数和比例
 */
struct LotteryProc { char name; int tickets, runs; };

/* ==== CODE START ==== */
void lottery_simulate(LotteryProc procs[], int n, int total_draws) {
    // TODO: 计算总票数
    //  循环total_draws次，每次随机选一张彩票
    //  输出 "Lottery results after N draws:"
    //  输出 "PX: N runs (Y%)"
    //  输出 "Expected vs Actual: PX: E% vs A%"
}
/* ==== CODE END ==== */

int main() {
    LotteryProc procs[] = {{'A',50,0},{'B',30,0},{'C',20,0}};
    /* ==== CODE START ==== */
    srand(time(NULL));
    lottery_simulate(procs, 3, 100);
    /* ==== CODE END ==== */
    return 0;
}
''',r'''#include <cstdio>
#include <cstdlib>
#include <ctime>
struct LotteryProc{char name;int tickets,runs;};
void lottery_simulate(LotteryProc procs[],int n,int total_draws){
    int total_tickets=0;for(int i=0;i<n;i++)total_tickets+=procs[i].tickets;
    for(int d=0;d<total_draws;d++){int r=rand()%total_tickets;int accum=0;
        for(int i=0;i<n;i++){accum+=procs[i].tickets;if(r<accum){procs[i].runs++;break;}}}
    printf("Lottery results after %d draws:\n",total_draws);
    for(int i=0;i<n;i++)printf("P%c: %d runs (%.0f%%)\n",procs[i].name,procs[i].runs,100.0*procs[i].runs/total_draws);
    printf("Expected vs Actual:");
    for(int i=0;i<n;i++)printf(" P%c: %.1f%% vs %.0f%%",procs[i].name,100.0*procs[i].tickets/total_tickets,100.0*procs[i].runs/total_draws);
    printf("\n");
}
int main(){LotteryProc procs[]={{'A',50,0},{'B',30,0},{'C',20,0}};srand(time(NULL));lottery_simulate(procs,3,100);return 0;}
''')

upsert('lab28_lottery','python',r'''#!/usr/bin/env python3
"""
彩票调度算法实验
目标：实现比例分享(lottery scheduling)调度算法
提示：
  - 每个进程持有一定数量的彩票(tickets)
  - 每次调度随机选一张彩票，持有该彩票的进程运行
"""
import random
class LotteryProc:
    def __init__(s,name,tickets):s.name=name;s.tickets=tickets;s.runs=0

def lottery_simulate(procs, total_draws):
    # ==== CODE START ====
    # TODO: 计算总票数，循环total_draws次随机选票
    #  输出 "Lottery results after N draws:"
    #  输出 "PX: N runs (Y%)"
    #  输出 "Expected vs Actual: PX: E% vs A%"
    # ==== CODE END ====
    pass

if __name__=='__main__':
    procs=[LotteryProc('A',50),LotteryProc('B',30),LotteryProc('C',20)]
    # ==== CODE START ==== lottery_simulate(procs, 100) # ==== CODE END ====
''',r'''#!/usr/bin/env python3
import random
class LotteryProc:
    def __init__(s,name,tickets):s.name=name;s.tickets=tickets;s.runs=0
def lottery_simulate(procs,total_draws):
    n=len(procs)
    total_tickets=sum(p.tickets for p in procs)
    for d in range(total_draws):
        r=random.randint(0,total_tickets-1)
        accum=0
        for i in range(n):
            accum+=procs[i].tickets
            if r<accum: procs[i].runs+=1;break
    print("Lottery results after %d draws:"%total_draws)
    for p in procs: print("P%c: %d runs (%.0f%%)"%(p.name,p.runs,100.0*p.runs/total_draws))
    print("Expected vs Actual:",end="")
    for p in procs: print(" P%c: %.1f%% vs %.0f%%"%(p.name,100.0*p.tickets/total_tickets,100.0*p.runs/total_draws),end="")
    print()
if __name__=='__main__':
    procs=[LotteryProc('A',50),LotteryProc('B',30),LotteryProc('C',20)]
    random.seed()
    lottery_simulate(procs,100)
''')

upsert('lab28_lottery','go',r'''package main
import ("fmt";"math/rand";"time")
type LotteryProc struct{name byte;tickets,runs int}
func lotterySimulate(procs []LotteryProc,totalDraws int){
    /* ==== CODE START ==== */ // TODO: 实现彩票调度 /* ==== CODE END ==== */
}
func main(){
    procs:=[]LotteryProc{{'A',50,0},{'B',30,0},{'C',20,0}}
    /* ==== CODE START ==== */ rand.Seed(time.Now().UnixNano());lotterySimulate(procs,100) /* ==== CODE END ==== */
}
''',r'''package main
import ("fmt";"math/rand";"time")
type LotteryProc struct{name byte;tickets,runs int}
func lotterySimulate(procs []LotteryProc,totalDraws int){n:=len(procs);totalTickets:=0
    for i:=0;i<n;i++{totalTickets+=procs[i].tickets}
    for d:=0;d<totalDraws;d++{r:=rand.Intn(totalTickets);accum:=0
        for i:=0;i<n;i++{accum+=procs[i].tickets;if r<accum{procs[i].runs++;break}}}
    fmt.Printf("Lottery results after %d draws:\n",totalDraws)
    for i:=0;i<n;i++{fmt.Printf("P%c: %d runs (%.0f%%)\n",procs[i].name,procs[i].runs,100.0*float64(procs[i].runs)/float64(totalDraws))}
    fmt.Print("Expected vs Actual:")
    for i:=0;i<n;i++{fmt.Printf(" P%c: %.1f%% vs %.0f%%",procs[i].name,100.0*float64(procs[i].tickets)/float64(totalTickets),100.0*float64(procs[i].runs)/float64(totalDraws))}
    fmt.Println()
}
func main(){procs:=[]LotteryProc{{'A',50,0},{'B',30,0},{'C',20,0}};rand.Seed(time.Now().UnixNano());lotterySimulate(procs,100)}
''')

upsert('lab28_lottery','rust',r'''/*
 * 彩票调度算法实验
 * 目标：实现比例分享(lottery scheduling)调度算法
 */
use std::rand::Rng;
struct LotteryProc{name:char,tickets:i32,runs:i32}
fn lottery_simulate(procs:&mut Vec<LotteryProc>,total_draws:i32){
    /* ==== CODE START ==== */ // TODO: 实现彩票调度 /* ==== CODE END ==== */
}
fn main(){
    let mut procs=vec![LotteryProc{name:'A',tickets:50,runs:0},LotteryProc{name:'B',tickets:30,runs:0},LotteryProc{name:'C',tickets:20,runs:0}];
    /* ==== CODE START ==== */ lottery_simulate(&mut procs,100); /* ==== CODE END ==== */
}
''',r'''use std::rand::Rng;
struct LotteryProc{name:char,tickets:i32,runs:i32}
fn lottery_simulate(procs:&mut Vec<LotteryProc>,total_draws:i32){let n=procs.len();let total_tickets:i32=procs.iter().map(|p|p.tickets).sum();
    let mut rng=std::rand::thread_rng();
    for _ in 0..total_draws{let r=rng.gen_range(0..total_tickets);let mut accum=0;
        for i in 0..n{accum+=procs[i].tickets;if r<accum{procs[i].runs+=1;break;}}}
    println!("Lottery results after {} draws:",total_draws);
    for p in procs.iter(){println!("P{}: {} runs ({:.0}%)",p.name,p.runs,100.0*p.runs as f64/total_draws as f64);}
    print!("Expected vs Actual:");
    for p in procs.iter(){print!(" P{}: {:.1}% vs {:.0}%",p.name,100.0*p.tickets as f64/total_tickets as f64,100.0*p.runs as f64/total_draws as f64);}
    println!();
}
fn main(){let mut procs=vec![LotteryProc{name:'A',tickets:50,runs:0},LotteryProc{name:'B',tickets:30,runs:0},LotteryProc{name:'C',tickets:20,runs:0}];lottery_simulate(&mut procs,100);}
''')
print('lab27-lab28 done')
