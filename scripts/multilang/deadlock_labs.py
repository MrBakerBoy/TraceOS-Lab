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

# Fix lab28 Rust to use libc rand
upsert('lab28_lottery','rust',r'''/*
 * 彩票调度算法实验
 * 目标：实现比例分享(lottery scheduling)调度算法
 * 提示：
 *   - 每个进程持有一定数量的彩票(tickets)
 *   - 每次调度随机选一张彩票，持有该彩票的进程运行
 *   - 使用 libc 的 rand() 生成随机数（Rust 标准库不含 rand crate）
 */
use std::os::raw::c_int;
extern "C" {
    fn rand() -> c_int;
    fn srand(seed: c_int);
    fn time(t: *mut c_int) -> c_int;
}
struct LotteryProc{name:char,tickets:i32,runs:i32}
fn lottery_simulate(procs:&mut Vec<LotteryProc>,total_draws:i32){
    /* ==== CODE START ==== */
    // TODO: 计算总票数，循环total_draws次随机选票
    //  输出 "Lottery results after N draws:"
    //  输出 "PX: N runs (Y%)"
    //  输出 "Expected vs Actual: PX: E% vs A%"
    /* ==== CODE END ==== */
}
fn main(){
    let mut procs=vec![LotteryProc{name:'A',tickets:50,runs:0},LotteryProc{name:'B',tickets:30,runs:0},LotteryProc{name:'C',tickets:20,runs:0}];
    /* ==== CODE START ==== */ unsafe{srand(time(std::ptr::null_mut()) as c_int);lottery_simulate(&mut procs,100);} /* ==== CODE END ==== */
}
''',r'''use std::os::raw::c_int;
extern "C"{fn rand()->c_int;fn srand(seed:c_int);fn time(t:*mut c_int)->c_int;}
struct LotteryProc{name:char,tickets:i32,runs:i32}
fn lottery_simulate(procs:&mut Vec<LotteryProc>,total_draws:i32){let n=procs.len();let total_tickets:i32=procs.iter().map(|p|p.tickets).sum();
    for _ in 0..total_draws{let r=unsafe{rand()}%total_tickets;let mut accum=0;
        for i in 0..n{accum+=procs[i].tickets;if r<accum{procs[i].runs+=1;break;}}}
    println!("Lottery results after {} draws:",total_draws);
    for p in procs.iter(){println!("P{}: {} runs ({:.0}%)",p.name,p.runs,100.0*p.runs as f64/total_draws as f64);}
    print!("Expected vs Actual:");
    for p in procs.iter(){print!(" P{}: {:.1}% vs {:.0}%",p.name,100.0*p.tickets as f64/total_tickets as f64,100.0*p.runs as f64/total_draws as f64);}
    println!();
}
fn main(){let mut procs=vec![LotteryProc{name:'A',tickets:50,runs:0},LotteryProc{name:'B',tickets:30,runs:0},LotteryProc{name:'C',tickets:20,runs:0}];
    unsafe{srand(time(std::ptr::null_mut()) as c_int);lottery_simulate(&mut procs,100);}}
''')

# ==================== lab29_banker ====================
upsert('lab29_banker','cpp',r'''#include <cstdio>
#include <vector>

/**
 * 银行家算法实验
 * 目标：实现死锁避免算法，验证安全状态
 * 提示：
 *   - Need[i][j] = Max[i][j] - Allocation[i][j]
 *   - Available[j] = 总资源 - sum(Allocation[*][j])
 *   - 安全性算法：模拟分配，找到安全序列
 *   - 请求算法：假设批准请求，检测是否仍安全
 *   - 安全序列输出为 "Safe sequence: P1, P3, ..."
 */
#define P 5
#define R 3

/* ==== CODE START ==== */
bool is_safe(int avail[], int max[][R], int alloc[][R], int need[][R], int seq[]) {
    // TODO: 实现安全性检测算法
    //  work = avail副本
    //  finish[]标记已完成进程
    //  重复找 need[i] <= work 的未完成进程
    //  找到则 work += alloc[i]，记录序列
    //  如果找不到且还有未完成进程 → 不安全
}
/* ==== CODE END ==== */

int main() {
    int avail[R] = {3,3,2};
    int max[P][R] = {{7,5,3},{3,2,2},{9,0,2},{2,2,2},{4,3,3}};
    int alloc[P][R] = {{0,1,0},{2,0,0},{3,0,2},{2,1,1},{0,0,2}};
    int need[P][R];
    for(int i=0;i<P;i++)for(int j=0;j<R;j++)need[i][j]=max[i][j]-alloc[i][j];
    /* ==== CODE START ==== */
    // TODO: 检测初始安全状态，输出安全序列
    //  测试 P1请求(1,0,2) → "Request granted: safe state"
    //  测试 P4请求(3,3,0) → "Request denied: unsafe state"
    //  输出 "Bankers algorithm test complete"
    /* ==== CODE END ==== */
    return 0;
}
''',r'''#include <cstdio>
#include <cstring>
#define P 5
#define R 3
bool is_safe(int avail[],int max[][R],int alloc[][R],int need[][R],int seq[]){
    int work[R],finish[P]={0};for(int i=0;i<R;i++)work[i]=avail[i];int count=0;
    while(count<P){bool found=false;for(int i=0;i<P;i++){if(!finish[i]){int j;for(j=0;j<R;j++)if(need[i][j]>work[j])break;if(j==R){for(int k=0;k<R;k++)work[k]+=alloc[i][k];seq[count++]=i;finish[i]=1;found=true;}}}if(!found)return false;}
    return true;
}
int main(){int avail[R]={3,3,2};int max[P][R]={{7,5,3},{3,2,2},{9,0,2},{2,2,2},{4,3,3}};int alloc[P][R]={{0,1,0},{2,0,0},{3,0,2},{2,1,1},{0,0,2}};int need[P][R];
    for(int i=0;i<P;i++)for(int j=0;j<R;j++)need[i][j]=max[i][j]-alloc[i][j];
    int seq[P];if(is_safe(avail,max,alloc,need,seq)){printf("Safe sequence: P%d",seq[0]);for(int i=1;i<P;i++)printf(", P%d",seq[i]);printf("\n");}
    int req1[R]={1,0,2};bool g=true;for(int j=0;j<R;j++)if(req1[j]>need[1][j]||req1[j]>avail[j]){g=false;break;}
    if(g){for(int j=0;j<R;j++){avail[j]-=req1[j];alloc[1][j]+=req1[j];need[1][j]-=req1[j];}if(is_safe(avail,max,alloc,need,seq))printf("Request granted: safe state\n");else printf("Request denied: unsafe state\n");for(int j=0;j<R;j++){avail[j]+=req1[j];alloc[1][j]-=req1[j];need[1][j]+=req1[j];}}
    int req4[R]={3,3,0};g=true;for(int j=0;j<R;j++)if(req4[j]>need[4][j]||req4[j]>avail[j]){g=false;break;}
    if(g){for(int j=0;j<R;j++){avail[j]-=req4[j];alloc[4][j]+=req4[j];need[4][j]-=req4[j];}if(is_safe(avail,max,alloc,need,seq))printf("Request granted: safe state\n");else printf("Request denied: unsafe state\n");}else printf("Request denied: unsafe state\n");
    printf("Bankers algorithm test complete\n");return 0;}
''')

upsert('lab29_banker','python',r'''#!/usr/bin/env python3
"""
银行家算法实验
目标：实现死锁避免算法，验证安全状态
提示：
  - Need[i][j] = Max[i][j] - Allocation[i][j]
  - 安全性算法：模拟分配，找到安全序列
  - 请求算法：假设批准请求，检测是否仍安全
"""
P=5;R=3

def is_safe(avail,max_,alloc,need):
    # ==== CODE START ====
    # TODO: 实现安全性检测算法
    #  返回 (True, safe_sequence) 或 (False, [])
    # ==== CODE END ====
    return False,[]

if __name__=='__main__':
    avail=[3,3,2]
    max_=[[7,5,3],[3,2,2],[9,0,2],[2,2,2],[4,3,3]]
    alloc=[[0,1,0],[2,0,0],[3,0,2],[2,1,1],[0,0,2]]
    need=[[max_[i][j]-alloc[i][j] for j in range(R)] for i in range(P)]
    # ==== CODE START ====
    # TODO: 检测初始安全状态，输出安全序列
    #  测试 P1请求(1,0,2) → "Request granted: safe state"
    #  测试 P4请求(3,3,0) → "Request denied: unsafe state"
    #  输出 "Bankers algorithm test complete"
    # ==== CODE END ====
    pass
''',r'''#!/usr/bin/env python3
P=5;R=3
def is_safe(avail,max_,alloc,need):
    work=avail[:];finish=[False]*P;seq=[]
    while len(seq)<P:
        found=False
        for i in range(P):
            if not finish[i] and all(need[i][j]<=work[j] for j in range(R)):
                for k in range(R):work[k]+=alloc[i][k]
                seq.append(i);finish[i]=True;found=True
        if not found:return False,[]
    return True,seq
if __name__=='__main__':
    avail=[3,3,2];max_=[[7,5,3],[3,2,2],[9,0,2],[2,2,2],[4,3,3]];alloc=[[0,1,0],[2,0,0],[3,0,2],[2,1,1],[0,0,2]]
    need=[[max_[i][j]-alloc[i][j] for j in range(R)] for i in range(P)]
    ok,seq=is_safe(avail,max_,alloc,need)
    if ok:print("Safe sequence: "+", ".join("P%d"%s for s in seq))
    req1=[1,0,2]
    if all(req1[j]<=need[1][j] and req1[j]<=avail[j] for j in range(R)):
        for j in range(R):avail[j]-=req1[j];alloc[1][j]+=req1[j];need[1][j]-=req1[j]
        ok,_=is_safe(avail,max_,alloc,need)
        print("Request granted: safe state" if ok else "Request denied: unsafe state")
        for j in range(R):avail[j]+=req1[j];alloc[1][j]-=req1[j];need[1][j]+=req1[j]
    req4=[3,3,0]
    if all(req4[j]<=need[4][j] and req4[j]<=avail[j] for j in range(R)):
        for j in range(R):avail[j]-=req4[j];alloc[4][j]+=req4[j];need[4][j]-=req4[j]
        ok,_=is_safe(avail,max_,alloc,need)
        print("Request granted: safe state" if ok else "Request denied: unsafe state")
    else:
        print("Request denied: unsafe state")
    print("Bankers algorithm test complete")
''')

upsert('lab29_banker','go',r'''package main
import "fmt"
const P=5;const R=3
func isSafe(avail []int,maxM,alloc,need [][]int)(bool,[]int){
    /* ==== CODE START ==== */ // TODO: 安全性检测 /* ==== CODE END ==== */
    return false,nil
}
func main(){
    avail:=[]int{3,3,2};maxM:=[][]int{{7,5,3},{3,2,2},{9,0,2},{2,2,2},{4,3,3}};alloc:=[][]int{{0,1,0},{2,0,0},{3,0,2},{2,1,1},{0,0,2}}
    need:=make([][]int,P);for i:=0;i<P;i++{need[i]=make([]int,R);for j:=0;j<R;j++{need[i][j]=maxM[i][j]-alloc[i][j]}}
    /* ==== CODE START ==== */ // TODO: 测试请求并输出 /* ==== CODE END ==== */
}
''',r'''package main
import "fmt"
const P=5;const R=3
func isSafe(avail []int,maxM,alloc,need [][]int)(bool,[]int){
    work:=make([]int,R);copy(work,avail);finish:=make([]bool,P);seq:=[]int{}
    for len(seq)<P{found:=false;for i:=0;i<P;i++{if!finish[i]{ok:=true;for j:=0;j<R;j++{if need[i][j]>work[j]{ok=false;break}};if ok{for k:=0;k<R;k++{work[k]+=alloc[i][k]};seq=append(seq,i);finish[i]=true;found=true}}};if!found{return false,nil}}
    return true,seq
}
func main(){
    avail:=[]int{3,3,2};maxM:=[][]int{{7,5,3},{3,2,2},{9,0,2},{2,2,2},{4,3,3}};alloc:=[][]int{{0,1,0},{2,0,0},{3,0,2},{2,1,1},{0,0,2}}
    need:=make([][]int,P);for i:=0;i<P;i++{need[i]=make([]int,R);for j:=0;j<R;j++{need[i][j]=maxM[i][j]-alloc[i][j]}}
    ok,seq:=isSafe(avail,maxM,alloc,need)
    if ok{fmt.Printf("Safe sequence: P%d",seq[0]);for _,s:=range seq[1:]{fmt.Printf(", P%d",s)};fmt.Println()}
    req1:=[]int{1,0,2};g:=true;for j:=0;j<R;j++{if req1[j]>need[1][j]||req1[j]>avail[j]{g=false}}
    if g{for j:=0;j<R;j++{avail[j]-=req1[j];alloc[1][j]+=req1[j];need[1][j]-=req1[j]};ok,_=isSafe(avail,maxM,alloc,need);if ok{fmt.Println("Request granted: safe state")}else{fmt.Println("Request denied: unsafe state")};for j:=0;j<R;j++{avail[j]+=req1[j];alloc[1][j]-=req1[j];need[1][j]+=req1[j]}}
    req4:=[]int{3,3,0};g=true;for j:=0;j<R;j++{if req4[j]>need[4][j]||req4[j]>avail[j]{g=false}}
    if g{for j:=0;j<R;j++{avail[j]-=req4[j];alloc[4][j]+=req4[j];need[4][j]-=req4[j]};ok,_=isSafe(avail,maxM,alloc,need);if ok{fmt.Println("Request granted: safe state")}else{fmt.Println("Request denied: unsafe state")}}else{fmt.Println("Request denied: unsafe state")}
    fmt.Println("Bankers algorithm test complete")
}
''')

upsert('lab29_banker','rust',r'''/*
 * 银行家算法实验
 * 目标：实现死锁避免算法，验证安全状态
 */
const P:usize=5;const R:usize=3;
fn is_safe(avail:&[i32],max_m:&[[i32;R]],alloc:&[[i32;R]],need:&[[i32;R]])->(bool,Vec<usize>){
    /* ==== CODE START ==== */ // TODO: 安全性检测 /* ==== CODE END ==== */
    (false,vec![])
}
fn main(){
    let avail=[3,3,2];let max_m=[[7,5,3],[3,2,2],[9,0,2],[2,2,2],[4,3,3]];let alloc=[[0,1,0],[2,0,0],[3,0,2],[2,1,1],[0,0,2]];
    let mut need=[[0i32;R];P];for i in 0..P{for j in 0..R{need[i][j]=max_m[i][j]-alloc[i][j];}}
    /* ==== CODE START ==== */ // TODO: 测试请求并输出 /* ==== CODE END ==== */
}
''',r'''const P:usize=5;const R:usize=3;
fn is_safe(avail:&[i32],max_m:&[[i32;R]],alloc:&[[i32;R]],need:&[[i32;R]])->(bool,Vec<usize>){
    let mut work=[0i32;R];for i in 0..R{work[i]=avail[i];}let mut finish=[false;P];let mut seq=Vec::new();
    while seq.len()<P{let mut found=false;
        for i in 0..P{if!finish[i]{let mut ok=true;for j in 0..R{if need[i][j]>work[j]{ok=false;break;}}
            if ok{for k in 0..R{work[k]+=alloc[i][k];}seq.push(i);finish[i]=true;found=true;}}}
        if!found{return false,vec![];}}
    (true,seq)
}
fn main(){
    let mut avail=[3,3,2];let max_m=[[7,5,3],[3,2,2],[9,0,2],[2,2,2],[4,3,3]];let mut alloc=[[0,1,0],[2,0,0],[3,0,2],[2,1,1],[0,0,2]];
    let mut need=[[0i32;R];P];for i in 0..P{for j in 0..R{need[i][j]=max_m[i][j]-alloc[i][j];}}
    let(ok,seq)=is_safe(&avail,&max_m,&alloc,&need);
    if ok{print!("Safe sequence: P{}",seq[0]);for s in seq.iter().skip(1){print!(", P{}",s);}println!();}
    let req1=[1,0,2];let mut g=true;for j in 0..R{if req1[j]>need[1][j]||req1[j]>avail[j]{g=false;}}
    if g{for j in 0..R{avail[j]-=req1[j];alloc[1][j]+=req1[j];need[1][j]-=req1[j];}let(ok2,_)=is_safe(&avail,&max_m,&alloc,&need);if ok2{println!("Request granted: safe state");}else{println!("Request denied: unsafe state");}for j in 0..R{avail[j]+=req1[j];alloc[1][j]-=req1[j];need[1][j]+=req1[j];}}
    let req4=[3,3,0];g=true;for j in 0..R{if req4[j]>need[4][j]||req4[j]>avail[j]{g=false;}}
    if g{for j in 0..R{avail[j]-=req4[j];alloc[4][j]+=req4[j];need[4][j]-=req4[j];}let(ok3,_)=is_safe(&avail,&max_m,&alloc,&need);if ok3{println!("Request granted: safe state");}else{println!("Request denied: unsafe state");}}else{println!("Request denied: unsafe state");}
    println!("Bankers algorithm test complete");
}
''')

# ==================== lab30_deadlock_detect ====================
upsert('lab30_deadlock_detect','cpp',r'''#include <cstdio>
#include <cstring>

/**
 * 死锁检测实验：资源分配图算法
 * 目标：构建等待图，使用DFS检测环（死锁）
 * 提示：
 *   - 等待图：如果Pi等待Rj，Rj被Pk持有，则Pi→Pk有边
 *   - DFS从每个未访问节点开始，检测是否有back edge（环）
 *   - visited[3种状态]: 0=未访问, 1=访问中, 2=已完成
 *   - 检测到环时记录路径
 */
#define MAX_PROC 10
bool wait_graph[MAX_PROC][MAX_PROC];
int n;

/* ==== CODE START ==== */
bool dfs_detect_cycle(int v, int visited[], int path[], int* path_len) {
    // TODO: DFS检测环
    //  访问中(1)状态再碰到 → 发现环
    //  记录环路径并输出
}
/* ==== CODE END ==== */

int main() {
    /* ==== CODE START ==== */
    // 场景1：有死锁
    //  构建等待图：P0→P1→P2→P0 形成环
    //  输出 "Before release: Deadlock detected: P0 -> P1 -> P2 -> P0"
    // 场景2：释放资源后死锁解除
    //  移除P2→P0的边
    //  输出 "After release: No deadlock detected"
    /* ==== CODE END ==== */
    return 0;
}
''',r'''#include <cstdio>
#include <cstring>
#define MAX_PROC 10
bool wait_graph[MAX_PROC][MAX_PROC];int n;
bool dfs_detect_cycle(int v,int visited[],int path[],int*path_len){
    visited[v]=1;path[(*path_len)++]=v;
    for(int u=0;u<n;u++){if(wait_graph[v][u]){if(visited[u]==1){printf("Deadlock detected: P%d",u);for(int i=0;i<*path_len;i++)if(path[i]==u){for(int j=i;j<*path_len;j++)printf(" -> P%d",path[j]);break;}printf("\n");return true;}if(visited[u]==0){if(dfs_detect_cycle(u,visited,path,path_len))return true;}}}
    (*path_len)--;visited[v]=2;return false;
}
int main(){n=5;memset(wait_graph,0,sizeof(wait_graph));
    wait_graph[0][1]=true;wait_graph[1][2]=true;wait_graph[2][0]=true;
    printf("Before release: ");int visited[MAX_PROC]={0},path[MAX_PROC],path_len=0;bool deadlock=false;
    for(int i=0;i<n;i++)if(!visited[i]&&dfs_detect_cycle(i,visited,path,&path_len)){deadlock=true;break;}
    if(!deadlock)printf("No deadlock detected\n");
    memset(visited,0,sizeof(visited));wait_graph[2][0]=false;path_len=0;deadlock=false;
    printf("After release: ");
    for(int i=0;i<n;i++)if(!visited[i]&&dfs_detect_cycle(i,visited,path,&path_len)){deadlock=true;break;}
    if(!deadlock)printf("No deadlock detected\n");
    return 0;}
''')

upsert('lab30_deadlock_detect','python',r'''#!/usr/bin/env python3
"""
死锁检测实验：资源分配图算法
目标：构建等待图，使用DFS检测环（死锁）
提示：
  - 等待图：如果Pi等待Rj，Rj被Pk持有，则Pi→Pk有边
  - DFS从每个未访问节点开始，检测是否有back edge（环）
  - visited[3种状态]: 0=未访问, 1=访问中, 2=已完成
"""
n=0
wait_graph=[]

def dfs_detect_cycle(v,visited,path):
    # ==== CODE START ====
    # TODO: DFS检测环
    #  访问中(1)状态再碰到 → 发现环
    #  记录环路径并输出 "Deadlock detected: P0 -> P1 -> P2 -> P0"
    # ==== CODE END ====
    return False

if __name__=='__main__':
    # ==== CODE START ====
    # 场景1：有死锁 P0→P1→P2→P0
    # 场景2：释放后无死锁
    # ==== CODE END ====
    pass
''',r'''#!/usr/bin/env python3
n=5
wait_graph=[[False]*n for _ in range(n)]
def dfs_detect_cycle(v,visited,path):
    visited[v]=1;path.append(v)
    for u in range(n):
        if wait_graph[v][u]:
            if visited[u]==1:
                idx=path.index(u) if u in path else 0
                print("Deadlock detected: P%d"%u+" -> P"+" -> P".join(str(p) for p in path[idx:]))
                return True
            if visited[u]==0:
                if dfs_detect_cycle(u,visited,path):return True
    path.pop();visited[v]=2;return False
if __name__=='__main__':
    wait_graph[0][1]=True;wait_graph[1][2]=True;wait_graph[2][0]=True
    print("Before release: ",end="")
    visited=[0]*n;path=[];deadlock=False
    for i in range(n):
        if visited[i]==0 and dfs_detect_cycle(i,visited,path):deadlock=True;break
    if not deadlock:print("No deadlock detected")
    visited=[0]*n;path=[];deadlock=False;wait_graph[2][0]=False
    print("After release: ",end="")
    for i in range(n):
        if visited[i]==0 and dfs_detect_cycle(i,visited,path):deadlock=True;break
    if not deadlock:print("No deadlock detected")
''')

upsert('lab30_deadlock_detect','go',r'''package main
import "fmt"
var waitGraph [10][10]bool
var n int
func dfsDetectCycle(v int,visited,path []int,pathLen *int)bool{
    /* ==== CODE START ==== */ // TODO: DFS检测环 /* ==== CODE END ==== */
    return false
}
func main(){
    /* ==== CODE START ==== */ // 场景1和2 /* ==== CODE END ==== */
}
''',r'''package main
import "fmt"
var waitGraph [10][10]bool
var n int
func dfsDetectCycle(v int,visited,path []int,pathLen *int)bool{
    visited[v]=1;path[*pathLen]=v;*pathLen++
    for u:=0;u<n;u++{if waitGraph[v][u]{if visited[u]==1{fmt.Printf("Deadlock detected: P%d",u);for i:=0;i<*pathLen;i++{if path[i]==u{for j:=i;j<*pathLen;j++{fmt.Printf(" -> P%d",path[j])};break}};fmt.Println();return true};if visited[u]==0{if dfsDetectCycle(u,visited,path,pathLen){return true}}}}
    *pathLen--;visited[v]=2;return false
}
func main(){n=5
    waitGraph[0][1]=true;waitGraph[1][2]=true;waitGraph[2][0]=true
    fmt.Print("Before release: ")
    visited:=make([]int,10);path:=make([]int,10);pathLen:=0;deadlock:=false
    for i:=0;i<n;i++{if visited[i]==0&&dfsDetectCycle(i,visited,path,&pathLen){deadlock=true;break}}
    if!deadlock{fmt.Println("No deadlock detected")}
    for i:=range visited{visited[i]=0};waitGraph[2][0]=false;pathLen=0;deadlock=false
    fmt.Print("After release: ")
    for i:=0;i<n;i++{if visited[i]==0&&dfsDetectCycle(i,visited,path,&pathLen){deadlock=true;break}}
    if!deadlock{fmt.Println("No deadlock detected")}
}
''')

upsert('lab30_deadlock_detect','rust',r'''/*
 * 死锁检测实验：资源分配图算法
 * 目标：构建等待图，使用DFS检测环（死锁）
 */
const MAX_PROC:usize=10;
static mut WAIT_GRAPH:[[bool;MAX_PROC];MAX_PROC]=[[false;MAX_PROC];MAX_PROC];
static mut N:usize=0;
fn dfs_detect_cycle(v:usize,visited:&mut [i32],path:&mut [usize],path_len:&mut usize)->bool{
    /* ==== CODE START ==== */ // TODO: DFS检测环 /* ==== CODE END ==== */
    false
}
fn main(){
    /* ==== CODE START ==== */ // 场景1和2 /* ==== CODE END ==== */
}
''',r'''const MAX_PROC:usize=10;
static mut WAIT_GRAPH:[[bool;MAX_PROC];MAX_PROC]=[[false;MAX_PROC];MAX_PROC];
static mut N:usize=0;
fn dfs_detect_cycle(v:usize,visited:&mut [i32],path:&mut [usize],path_len:&mut usize)->bool{
    unsafe{
        visited[v]=1;path[*path_len]=v;*path_len+=1;
        for u in 0..N{if WAIT_GRAPH[v][u]{if visited[u]==1{
            print!("Deadlock detected: P{}",u);
            for i in 0..*path_len{if path[i]==u{for j in i..*path_len{print!(" -> P{}",path[j])}break}}
            println!();return true;
        }if visited[u]==0{if dfs_detect_cycle(u,visited,path,path_len){return true}}}}
        *path_len-=1;visited[v]=2;false
    }
}
fn main(){unsafe{
    N=5;
    WAIT_GRAPH[0][1]=true;WAIT_GRAPH[1][2]=true;WAIT_GRAPH[2][0]=true;
    print!("Before release: ");
    let mut visited=[0i32;MAX_PROC];let mut path=[0usize;MAX_PROC];let mut path_len=0;let mut deadlock=false;
    for i in 0..N{if visited[i]==0&&dfs_detect_cycle(i,&mut visited,&mut path,&mut path_len){deadlock=true;break}}
    if!deadlock{println!("No deadlock detected")}
    for v in visited.iter_mut(){*v=0};WAIT_GRAPH[2][0]=false;path_len=0;deadlock=false;
    print!("After release: ");
    for i in 0..N{if visited[i]==0&&dfs_detect_cycle(i,&mut visited,&mut path,&mut path_len){deadlock=true;break}}
    if!deadlock{println!("No deadlock detected")}
}}
''')

# ==================== lab31_deadlock_avoid ====================
upsert('lab31_deadlock_avoid','cpp',r'''#include <cstdio>
#include <thread>
#include <mutex>
#include <chrono>

/**
 * 死锁预防实验：资源有序分配
 * 目标：对比无序分配和有序分配，理解死锁预防策略
 * 提示：
 *   - 3个资源 R0, R1, R2 用3个std::mutex模拟
 *   - 场景A（无序）: T0 lock(R0)→R1, T1 lock(R1)→R0 → 死锁
 *   - 场景B（有序）: 都按 R0→R1 顺序 → 无死锁
 *   - 使用try_lock+超时避免死锁
 */
std::mutex R0, R1, R2;
std::mutex fin_mutex;
int threads_finished = 0;

void thread_unordered_0() {
    /* ==== CODE START ==== */
    // TODO: 先lock R0，再lock R1
    //  如果R1获取失败（try_lock超时2秒），释放R0
    //  操作完成后输出 "Thread 0: finished"
    /* ==== CODE END ==== */
}

void thread_unordered_1() {
    /* ==== CODE START ==== */
    // TODO: 先lock R1，再lock R0（与T0顺序相反，容易死锁）
    /* ==== CODE END ==== */
}

void thread_ordered(int id) {
    /* ==== CODE START ==== */
    // TODO: 始终按 R0→R1 顺序获取
    //  输出 "Thread N: finished"
    /* ==== CODE END ==== */
}

int main() {
    /* ==== CODE START ==== */
    // 场景A：无序分配，等待5秒
    //  输出 "Unordered: threads finished=N" 或 "Deadlock occurred"
    // 场景B：有序分配
    //  输出 "Ordered: threads finished=2"
    /* ==== CODE END ==== */
    return 0;
}
''',r'''#include <cstdio>
#include <thread>
#include <mutex>
#include <chrono>
std::mutex R0,R1,fin_mutex;int threads_finished=0;
void thread_unordered_0(){std::lock_guard<std::mutex> lk0(R0);std::this_thread::sleep_for(std::chrono::seconds(1));if(R1.try_lock()){std::lock_guard<std::mutex> lk1(R1,std::adopt_lock);std::lock_guard<std::mutex> lf(fin_mutex);threads_finished++;printf("Thread 0: finished\n");}else{printf("Thread 0: deadlock avoided\n");}}
void thread_unordered_1(){std::lock_guard<std::mutex> lk1(R1);std::this_thread::sleep_for(std::chrono::seconds(1));if(R0.try_lock()){std::lock_guard<std::mutex> lk0(R0,std::adopt_lock);std::lock_guard<std::mutex> lf(fin_mutex);threads_finished++;printf("Thread 1: finished\n");}else{printf("Thread 1: deadlock avoided\n");}}
void thread_ordered(int id){std::lock_guard<std::mutex> lk0(R0);std::this_thread::sleep_for(std::chrono::seconds(1));std::lock_guard<std::mutex> lk1(R1);std::lock_guard<std::mutex> lf(fin_mutex);threads_finished++;printf("Thread %d: finished\n",id);}
int main(){
    {std::thread t0(thread_unordered_0),t1(thread_unordered_1);t0.detach();t1.detach();std::this_thread::sleep_for(std::chrono::seconds(3));std::lock_guard<std::mutex> lf(fin_mutex);printf("Unordered: threads finished=%d\n",threads_finished);}
    threads_finished=0;
    {std::thread t0(thread_ordered,0),t1(thread_ordered,1);t0.join();t1.join();printf("Ordered: threads finished=%d\n",threads_finished);}
    return 0;}
''')

upsert('lab31_deadlock_avoid','python',r'''#!/usr/bin/env python3
"""
死锁预防实验：资源有序分配
目标：对比无序分配和有序分配，理解死锁预防策略
提示：
  - 使用 threading.Lock 模拟资源锁
  - 场景A（无序）: T0 lock(R0)→R1, T1 lock(R1)→R0
  - 场景B（有序）: 都按 R0→R1 顺序
  - 使用 acquire(timeout=2) 避免死锁
"""
import threading,time

R0=threading.Lock();R1=threading.Lock();fin_mutex=threading.Lock()
threads_finished=0

def thread_unordered_0():
    # ==== CODE START ====
    # TODO: 先lock R0，sleep 1s，再try_lock R1（timeout=2）
    #  成功输出 "Thread 0: finished"，失败输出 "Thread 0: deadlock avoided"
    # ==== CODE END ====
    pass

def thread_unordered_1():
    # ==== CODE START ====
    # TODO: 先lock R1，sleep 1s，再try_lock R0（timeout=2）
    # ==== CODE END ====
    pass

def thread_ordered(id):
    # ==== CODE START ====
    # TODO: 始终按 R0→R1 顺序
    #  输出 "Thread N: finished"
    # ==== CODE END ====
    pass

if __name__=='__main__':
    # ==== CODE START ====
    # 场景A：无序分配，等待3秒
    #  输出 "Unordered: threads finished=N"
    # 场景B：有序分配
    #  输出 "Ordered: threads finished=2"
    # ==== CODE END ====
    pass
''',r'''#!/usr/bin/env python3
import threading,time
R0=threading.Lock();R1=threading.Lock();fin=threading.Lock()
threads_finished=0
def thread_unordered_0():
    global threads_finished
    with R0:
        time.sleep(1)
        if R1.acquire(timeout=2):
            with fin:threads_finished+=1
            print("Thread 0: finished");R1.release()
        else:print("Thread 0: deadlock avoided")
def thread_unordered_1():
    global threads_finished
    with R1:
        time.sleep(1)
        if R0.acquire(timeout=2):
            with fin:threads_finished+=1
            print("Thread 1: finished");R0.release()
        else:print("Thread 1: deadlock avoided")
def thread_ordered(id):
    global threads_finished
    with R0:
        time.sleep(1)
        with R1:
            with fin:threads_finished+=1
            print("Thread %d: finished"%id)
if __name__=='__main__':
    t0=threading.Thread(target=thread_unordered_0);t1=threading.Thread(target=thread_unordered_1)
    t0.start();t1.start();time.sleep(3);t0.join(timeout=0.1);t1.join(timeout=0.1)
    print("Unordered: threads finished=%d"%threads_finished)
    threads_finished=0
    t0=threading.Thread(target=thread_ordered,args=(0,));t1=threading.Thread(target=thread_ordered,args=(1,))
    t0.start();t1.start();t0.join();t1.join()
    print("Ordered: threads finished=%d"%threads_finished)
''')

upsert('lab31_deadlock_avoid','go',r'''package main
import ("fmt";"sync";"time")
var R0,R1,fin sync.Mutex
var threadsFinished int
func threadUnordered0(wg *sync.WaitGroup){
    /* ==== CODE START ==== */ // TODO: lock R0, sleep, try_lock R1 /* ==== CODE END ==== */
    wg.Done()
}
func threadUnordered1(wg *sync.WaitGroup){
    /* ==== CODE START ==== */ // TODO: lock R1, sleep, try_lock R0 /* ==== CODE END ==== */
    wg.Done()
}
func threadOrdered(id int,wg *sync.WaitGroup){
    /* ==== CODE START ==== */ // TODO: lock R0→R1 in order /* ==== CODE END ==== */
    wg.Done()
}
func main(){
    /* ==== CODE START ==== */ // 场景A和场景B /* ==== CODE END ==== */
}
''',r'''package main
import ("fmt";"sync";"time")
var R0,R1,fin sync.Mutex
var threadsFinished int
func threadUnordered0(wg *sync.WaitGroup){defer wg.Done()
    R0.Lock();time.Sleep(1*time.Second)
    if R1.TryLock(){fin.Lock();threadsFinished++;fin.Unlock();fmt.Println("Thread 0: finished");R1.Unlock()}else{fmt.Println("Thread 0: deadlock avoided")}
    R0.Unlock()}
func threadUnordered1(wg *sync.WaitGroup){defer wg.Done()
    R1.Lock();time.Sleep(1*time.Second)
    if R0.TryLock(){fin.Lock();threadsFinished++;fin.Unlock();fmt.Println("Thread 1: finished");R0.Unlock()}else{fmt.Println("Thread 1: deadlock avoided")}
    R1.Unlock()}
func threadOrdered(id int,wg *sync.WaitGroup){defer wg.Done()
    R0.Lock();time.Sleep(1*time.Second);R1.Lock()
    fin.Lock();threadsFinished++;fin.Unlock();fmt.Printf("Thread %d: finished\n",id)
    R1.Unlock();R0.Unlock()}
func main(){var wg sync.WaitGroup
    wg.Add(2);go threadUnordered0(&wg);go threadUnordered1(&wg);time.Sleep(3*time.Second);wg.Wait()
    fin.Lock();fmt.Printf("Unordered: threads finished=%d\n",threadsFinished);fin.Unlock()
    threadsFinished=0
    wg.Add(2);go threadOrdered(0,&wg);go threadOrdered(1,&wg);wg.Wait()
    fmt.Printf("Ordered: threads finished=%d\n",threadsFinished)
}
''')

upsert('lab31_deadlock_avoid','rust',r'''/*
 * 死锁预防实验：资源有序分配
 * 目标：对比无序分配和有序分配，理解死锁预防策略
 * 提示：
 *   - 使用 std::sync::Mutex 模拟资源锁
 *   - 场景A（无序）: T0 lock(R0)→R1, T1 lock(R1)→R0
 *   - 场景B（有序）: 都按 R0→R1 顺序
 *   - 使用 try_lock() 避免死锁
 */
use std::sync::{Mutex, Arc};
use std::thread;
use std::time::Duration;

fn main(){
    /* ==== CODE START ==== */
    // TODO: 创建共享的 R0, R1, fin Mutex
    //  场景A：无序分配，等待3秒
    //  场景B：有序分配
    /* ==== CODE END ==== */
}
''',r'''use std::sync::{Mutex,Arc};use std::thread;use std::time::Duration;
fn main(){
    let r0=Arc::new(Mutex::new(()));let r1=Arc::new(Mutex::new(()));let fin=Arc::new(Mutex::new(0));
    // 场景A：无序分配
    let r0a=r0.clone();let r1a=r1.clone();let fina=fin.clone();
    let t0=thread::spawn(move||{let _l0=r0a.lock().unwrap();thread::sleep(Duration::from_secs(1));
        if let Ok(_l1)=r1a.try_lock(){let mut f=fina.lock().unwrap();*f+=1;println!("Thread 0: finished");}else{println!("Thread 0: deadlock avoided");}});
    let r0b=r0.clone();let r1b=r1.clone();let finb=fin.clone();
    let t1=thread::spawn(move||{let _l1=r1b.lock().unwrap();thread::sleep(Duration::from_secs(1));
        if let Ok(_l0)=r0b.try_lock(){let mut f=finb.lock().unwrap();*f+=1;println!("Thread 1: finished");}else{println!("Thread 1: deadlock avoided");}});
    thread::sleep(Duration::from_secs(3));let _=t0.join();let _=t1.join();
    let f=fin.lock().unwrap();println!("Unordered: threads finished={}",*f);drop(f);
    // 场景B：有序分配
    *fin.lock().unwrap()=0;
    let r0c=r0.clone();let r1c=r1.clone();let finc=fin.clone();
    let t0=thread::spawn(move||{let _l0=r0c.lock().unwrap();thread::sleep(Duration::from_secs(1));let _l1=r1c.lock().unwrap();
        let mut f=finc.lock().unwrap();*f+=1;println!("Thread 0: finished");});
    let r0d=r0.clone();let r1d=r1.clone();let find=fin.clone();
    let t1=thread::spawn(move||{let _l0=r0d.lock().unwrap();thread::sleep(Duration::from_secs(1));let _l1=r1d.lock().unwrap();
        let mut f=find.lock().unwrap();*f+=1;println!("Thread 1: finished");});
    let _=t0.join();let _=t1.join();
    let f=fin.lock().unwrap();println!("Ordered: threads finished={}",*f);
}
''')
print('lab28-fix + lab29-lab31 done')
