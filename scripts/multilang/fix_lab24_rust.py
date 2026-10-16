import subprocess
def get_exp_id(name):
    r = subprocess.run(['docker','exec','-i','traceos-postgres','psql','-U','traceos','-d','traceos','-t','-A','-c',f"SELECT id FROM experiments WHERE name='{name}'"], capture_output=True, text=True)
    return r.stdout.strip()
def esc(s): return "'" + s.replace("'", "''") + "'"
exp_id = get_exp_id('lab24_sched_sim')
ref = r'''#[derive(Clone)]
struct Process{pid:i32,arrival:i32,burst:i32,priority:i32,remaining:i32,wait:i32,turnaround:i32,done:bool}

fn fcfs(p:&mut Vec<Process>){let n=p.len();
    p.sort_by_key(|x|x.arrival);
    let(mut time,tw,tt)=(0,0.0,0.0);
    for i in 0..n{if time<p[i].arrival{time=p[i].arrival};p[i].wait=time-p[i].arrival;time+=p[i].burst;p[i].turnaround=time-p[i].arrival;tw+=p[i].wait as f64;tt+=p[i].turnaround as f64;}
    println!("FCFS: avg wait={:.1}, avg turnaround={:.1}",tw/n as f64,tt/n as f64);}
fn sjf(p:&mut Vec<Process>){let n=p.len();let(mut done,mut time,mut tw,mut tt)=(0,0,0.0,0.0);
    while done<n{let(mut best,mut mb)=(-1,i32::MAX);for i in 0..n{if!p[i].done&&p[i].arrival<=time&&p[i].burst<mb{best=i as i32;mb=p[i].burst;}}if best==-1{time+=1;continue;}let b=best as usize;p[b].wait=time-p[b].arrival;time+=p[b].burst;p[b].turnaround=time-p[b].arrival;tw+=p[b].wait as f64;tt+=p[b].turnaround as f64;p[b].done=true;done+=1;}
    println!("SJF:  avg wait={:.1}, avg turnaround={:.1}",tw/n as f64,tt/n as f64);}
fn rr(p:&mut Vec<Process>,q:i32){let n=p.len();let(mut done,mut time,mut tw,mut tt)=(0,0,0.0,0.0);
    while done<n{let mut run=false;for i in 0..n{if!p[i].done&&p[i].arrival<=time{let t=p[i].remaining.min(q);p[i].remaining-=t;time+=t;run=true;if p[i].remaining==0{p[i].done=true;done+=1;p[i].turnaround=time-p[i].arrival;p[i].wait=p[i].turnaround-p[i].burst;tw+=p[i].wait as f64;tt+=p[i].turnaround as f64;}}}if!run{time+=1;}}
    println!("RR:   avg wait={:.1}, avg turnaround={:.1}",tw/n as f64,tt/n as f64);}
fn priority_sched(p:&mut Vec<Process>){let n=p.len();let(mut done,mut time,mut tw,mut tt)=(0,0,0.0,0.0);
    while done<n{let(mut best,mut mp)=(-1,i32::MAX);for i in 0..n{if!p[i].done&&p[i].arrival<=time&&p[i].priority<mp{best=i as i32;mp=p[i].priority;}}if best==-1{time+=1;continue;}let b=best as usize;p[b].wait=time-p[b].arrival;time+=p[b].burst;p[b].turnaround=time-p[b].arrival;tw+=p[b].wait as f64;tt+=p[b].turnaround as f64;p[b].done=true;done+=1;}
    println!("Priority: avg wait={:.1}, avg turnaround={:.1}",tw/n as f64,tt/n as f64);}
fn main(){
    let mut p=vec![Process{pid:1,arrival:0,burst:8,priority:2,remaining:8,wait:0,turnaround:0,done:false},Process{pid:2,arrival:1,burst:4,priority:1,remaining:4,wait:0,turnaround:0,done:false},Process{pid:3,arrival:2,burst:9,priority:3,remaining:9,wait:0,turnaround:0,done:false},Process{pid:4,arrival:3,burst:5,priority:2,remaining:5,wait:0,turnaround:0,done:false}];
    fcfs(&mut p);sjf(&mut p);rr(&mut p,2);priority_sched(&mut p);
    println!("Scheduler simulation complete");
}
'''
sql = f"""UPDATE experiment_code_templates SET reference_solution={esc(ref)}, updated_at=NOW() WHERE experiment_id='{exp_id}' AND language='rust';"""
r = subprocess.run(['docker','exec','-i','traceos-postgres','psql','-U','traceos','-d','traceos','-c',sql], capture_output=True, text=True)
print('OK' if r.returncode==0 else f'ERROR: {r.stderr}')
