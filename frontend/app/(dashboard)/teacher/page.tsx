"use client";

import { useEffect, useState, useRef, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import * as echarts from "echarts";
import { api } from "@/lib/api";
import { getUser } from "@/lib/auth";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Users, FileCode, BookOpen, CheckCircle2, TrendingUp, AlertTriangle, BarChart3, Award, Activity, Zap, Sparkles, Brain, Clock, Download, RefreshCw, Target, Lightbulb, ChevronRight, Star, Flame, Layers, PieChart, GraduationCap } from "lucide-react";

interface ExperimentStat { experiment_id: string; title: string; category: string; total_submissions: number; passed_submissions: number; pass_rate: number; avg_score: number; }
interface ScoreBucket { range: string; count: number; }
interface DailyCount { date: string; count: number; }
interface DashboardOverview { total_students: number; total_submissions: number; total_experiments: number; avg_pass_rate: number; }
interface DashboardData { experiment_stats: ExperimentStat[]; score_distribution: ScoreBucket[]; daily_submissions: DailyCount[]; difficult_experiments: ExperimentStat[]; overview: DashboardOverview; }
interface AIAnalysis { summary: string; error_patterns: string[]; teaching_suggestions: string[]; challenging_experiments: string[]; }

const isDark = () => typeof document !== "undefined" && document.documentElement.classList.contains("dark");
const txColor = () => isDark() ? "rgba(255,255,255,0.56)" : "rgba(0,0,0,0.48)";
const bdColor = () => isDark() ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)";
const categoryColors: Record<string, string> = { process: "#0A84FF", thread: "#BF5AF2", memory: "#30D158", scheduler: "#FF9F0A", fs: "#FF375F", deadlock: "#FF6482" };
const categoryNames: Record<string, string> = { process: "进程", thread: "线程", memory: "内存", scheduler: "调度", fs: "文件系统", deadlock: "死锁" };
const scoreColor = (s: number) => s >= 80 ? "#30D158" : s >= 50 ? "#FF9F0A" : "#FF453A";

function AnimatedNumber({ value, decimals = 0, suffix = "" }: { value: number; decimals?: number; suffix?: string }) {
  const [d, sd] = useState(0); useEffect(() => { let s = 0; const inc = value / 50; const t = setInterval(() => { s += inc; s >= value ? (sd(value), clearInterval(t)) : sd(s); }, 30); return () => clearInterval(t); }, [value]);
  return <>{decimals > 0 ? d.toFixed(decimals) : Math.floor(d)}{suffix}</>;
}

function SparklesBg() {
  const dots = useMemo(() => Array.from({length:25},(_,i)=>({x:Math.random()*100,y:Math.random()*100,s:2+Math.random()*5,d:Math.random()*5,c:["#0A84FF","#BF5AF2","#30D158","#FF9F0A","#FF375F"][i%5]})),[]);
  return <div className="absolute inset-0 pointer-events-none overflow-hidden" style={{zIndex:0}}>{dots.map((p:any,i:number)=><div key={i} className="absolute rounded-full" style={{width:p.s,height:p.s,left:p.x+"%",top:p.y+"%",background:p.c,opacity:0.25,animation:"float "+(3+p.d)+"s ease-in-out "+p.d+"s infinite"}}/>)}</div>;
}

function OverviewCards({ overview }: { overview: DashboardOverview }) {
  const items = [
    { label: "学生总数", value: overview.total_students, icon: Users, color: "#0A84FF", bg: "rgba(10,132,255,0.1)", glow: "rgba(10,132,255,0.3)" },
    { label: "提交总数", value: overview.total_submissions, icon: FileCode, color: "#BF5AF2", bg: "rgba(191,90,242,0.1)", glow: "rgba(191,90,242,0.3)" },
    { label: "实验数量", value: overview.total_experiments, icon: BookOpen, color: "#FF9F0A", bg: "rgba(255,159,10,0.1)", glow: "rgba(255,159,10,0.3)" },
    { label: "平均通过率", value: overview.avg_pass_rate, icon: CheckCircle2, color: "#30D158", bg: "rgba(48,209,88,0.1)", glow: "rgba(48,209,88,0.3)", decimals: 2, suffix: "%" },
  ];
  return <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">{items.map((item:any,idx:number)=><div key={item.label} className="group relative rounded-2xl border border-border/50 bg-card p-5 transition-all duration-500 hover:-translate-y-1.5 hover:shadow-2xl overflow-hidden" style={{boxShadow:"0 0 40px -15px "+item.glow}}><div className="absolute top-0 left-4 right-4 h-[1px] bg-gradient-to-r from-transparent via-primary/30 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500"/><div className="flex items-center justify-between mb-3 relative z-10"><span className="text-[11px] text-muted-foreground uppercase tracking-[0.15em] font-semibold">{item.label}</span><div className="w-9 h-9 rounded-xl flex items-center justify-center transition-all duration-300 group-hover:scale-110 group-hover:rotate-3" style={{backgroundColor:item.bg}}><item.icon className="size-4" style={{color:item.color}}/></div></div><span className="text-[32px] font-bold tracking-tight relative z-10" style={{color:item.color}}><AnimatedNumber value={item.value} decimals={item.decimals||0} suffix={item.suffix||""}/></span><div className="absolute bottom-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-border/30 to-transparent"/></div>)}</div>;
}

function PassRateChart({ stats }: { stats: ExperimentStat[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current || stats.length === 0) return;
    const inst = echarts.init(ref.current, undefined, {renderer:"canvas"});
    const s = stats.slice(0, 15);
    const names = s.map(x => x.title.length > 10 ? x.title.slice(0, 9) + "..." : x.title).reverse();
    const rates = s.map(x => x.pass_rate).reverse();
    const cats = s.map(x => x.category).reverse();
    inst.setOption({backgroundColor:"transparent",tooltip:{trigger:"axis",axisPointer:{type:"shadow"},backgroundColor:"rgba(20,20,30,0.95)",borderColor:"rgba(255,255,255,0.1)",textStyle:{color:"#fff",fontSize:12}},grid:{left:100,right:60,top:10,bottom:10},xAxis:{type:"value",max:100,axisLabel:{color:txColor(),fontSize:10,formatter:"{value}%"},splitLine:{lineStyle:{color:bdColor(),type:"dashed"}}},yAxis:{type:"category",data:names,axisLabel:{color:txColor(),fontSize:10,width:90,overflow:"truncate"},axisLine:{show:false},axisTick:{show:false}},series:[{type:"bar",data:rates.map((v,i)=>({value:v,itemStyle:{color:new echarts.graphic.LinearGradient(0,0,1,0,[{offset:0,color:categoryColors[cats[i]]||"#0A84FF"},{offset:1,color:(categoryColors[cats[i]]||"#0A84FF")+"88"}]),borderRadius:[0,8,8,0],shadowBlur:10,shadowColor:(categoryColors[cats[i]]||"#0A84FF")+"44",shadowOffsetX:2}})),barWidth:18,label:{show:true,position:"right",color:txColor(),fontSize:10,formatter:(p:any)=>p.value.toFixed(1)+"%"},animationDuration:1500,animationEasing:"elasticOut"}]});
    const hr = () => inst.resize(); window.addEventListener("resize", hr);
    return () => { window.removeEventListener("resize", hr); inst.dispose(); };
  }, [stats]);
  return <div ref={ref} style={{height:320}}/>;
}

function ScoreDistChart({ dist }: { dist: ScoreBucket[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current || dist.length === 0) return;
    const inst = echarts.init(ref.current, undefined, {renderer:"canvas"});
    const colors = ["#FF453A","#FF6B5A","#FF9F0A","#FFB340","#FFD60A","#FFE54D","#BFE05A","#7ED957","#30D158","#0A84FF"];
    inst.setOption({backgroundColor:"transparent",tooltip:{trigger:"axis",backgroundColor:"rgba(20,20,30,0.95)",borderColor:"rgba(255,255,255,0.1)",textStyle:{color:"#fff",fontSize:12}},grid:{left:40,right:20,top:20,bottom:30},xAxis:{type:"category",data:dist.map(d=>d.range),axisLabel:{color:txColor(),fontSize:10},axisTick:{show:false}},yAxis:{type:"value",axisLabel:{color:txColor(),fontSize:10},splitLine:{lineStyle:{color:bdColor(),type:"dashed"}}},series:[{type:"bar",data:dist.map((d,i)=>({value:d.count,itemStyle:{color:new echarts.graphic.LinearGradient(0,0,0,1,[{offset:0,color:colors[i]||"#0A84FF"},{offset:1,color:(colors[i]||"#0A84FF")+"44"}]),borderRadius:[8,8,0,0]}})),barWidth:"55%",label:{show:true,position:"top",color:txColor(),fontSize:11,fontWeight:"bold"},animationDuration:1200}]});
    const hr = () => inst.resize(); window.addEventListener("resize", hr);
    return () => { window.removeEventListener("resize", hr); inst.dispose(); };
  }, [dist]);
  return <div ref={ref} style={{height:280}}/>;
}

function DailyTrendChart({ daily }: { daily: DailyCount[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current || daily.length === 0) return;
    const inst = echarts.init(ref.current, undefined, {renderer:"canvas"});
    inst.setOption({backgroundColor:"transparent",tooltip:{trigger:"axis",backgroundColor:"rgba(20,20,30,0.95)",borderColor:"rgba(255,255,255,0.1)",textStyle:{color:"#fff",fontSize:12}},grid:{left:40,right:20,top:20,bottom:30},xAxis:{type:"category",data:daily.map(d=>d.date.slice(5)),axisLabel:{color:txColor(),fontSize:10},axisLine:{lineStyle:{color:bdColor()}}},yAxis:{type:"value",axisLabel:{color:txColor(),fontSize:10},splitLine:{lineStyle:{color:bdColor(),type:"dashed"}}},series:[{type:"line",data:daily.map(d=>d.count),smooth:true,symbol:"circle",symbolSize:6,lineStyle:{width:2.5,color:new echarts.graphic.LinearGradient(0,0,1,0,[{offset:0,color:"#0A84FF"},{offset:1,color:"#BF5AF2"}])},itemStyle:{color:"#0A84FF",borderColor:"#fff",borderWidth:2},areaStyle:{color:new echarts.graphic.LinearGradient(0,0,0,1,[{offset:0,color:"rgba(10,132,255,0.3)"},{offset:1,color:"rgba(10,132,255,0.02)"}])},animationDuration:2000}]});
    const hr = () => inst.resize(); window.addEventListener("resize", hr);
    return () => { window.removeEventListener("resize", hr); inst.dispose(); };
  }, [daily]);
  return <div ref={ref} style={{height:260}}/>;
}

function CategoryDonutChart({ stats }: { stats: ExperimentStat[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const catData = useMemo(() => {
    const map: Record<string, {total:number;passed:number}> = {};
    stats.forEach(s => { if (!map[s.category]) map[s.category] = {total:0,passed:0}; map[s.category].total += s.total_submissions; map[s.category].passed += s.passed_submissions; });
    return Object.entries(map).map(([cat,d]) => ({ name: categoryNames[cat]||cat, value: d.total, passed: d.passed, itemStyle: { color: categoryColors[cat]||"#888" } }));
  }, [stats]);
  useEffect(() => {
    if (!ref.current || catData.length === 0) return;
    const inst = echarts.init(ref.current, undefined, {renderer:"canvas"});
    inst.setOption({backgroundColor:"transparent",tooltip:{trigger:"item",backgroundColor:"rgba(20,20,30,0.95)",borderColor:"rgba(255,255,255,0.1)",textStyle:{color:"#fff",fontSize:12},formatter:(p:any)=>p.name+"<br/>提交: "+p.value+"<br/>通过: "+(catData[p.dataIndex]?.passed||0)},series:[{type:"pie",radius:["55%","80%"],center:["50%","50%"],avoidLabelOverlap:false,itemStyle:{borderRadius:4,borderColor:"rgba(0,0,0,0.2)",borderWidth:2},label:{show:false},emphasis:{label:{show:true,fontSize:14,fontWeight:"bold"},scaleSize:10},data:catData,animationDuration:1500}]});
    const hr = () => inst.resize(); window.addEventListener("resize", hr);
    return () => { window.removeEventListener("resize", hr); inst.dispose(); };
  }, [catData]);
  const totalSubs = catData.reduce((s:number,c:any)=>s+c.value,0);
  return <div className="relative"><div ref={ref} style={{height:240}}/><div className="absolute inset-0 flex items-center justify-center pointer-events-none"><div className="text-center"><div className="text-2xl font-bold">{totalSubs}</div><div className="text-[10px] text-muted-foreground">总提交</div></div></div></div>;
}

function DifficultCard({ exps }: { exps: ExperimentStat[] }) {
  return <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">{exps.slice(0,8).map((exp,i)=><div key={exp.experiment_id} className="group flex items-center gap-3 p-3 rounded-xl transition-all duration-300 hover:bg-muted/40 cursor-pointer"><div className="flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold" style={{background:"linear-gradient(135deg, "+(categoryColors[exp.category]||"#888")+"22, "+(categoryColors[exp.category]||"#888")+"44)",color:categoryColors[exp.category]||"#888"}}>{i+1}</div><div className="flex-1 min-w-0"><div className="text-[13px] font-medium truncate">{exp.title}</div><div className="flex items-center gap-2 mt-0.5"><span className="text-[11px] text-muted-foreground">{categoryNames[exp.category]||exp.category}</span><span className="text-[11px] text-muted-foreground/50">· {exp.total_submissions} 次提交</span></div></div><div className="flex-shrink-0 text-right"><div className="text-lg font-bold" style={{color:scoreColor(exp.pass_rate)}}>{exp.pass_rate.toFixed(1)}%</div><div className="w-16 h-1.5 rounded-full bg-muted mt-1 overflow-hidden"><div className="h-full rounded-full transition-all duration-700" style={{width:exp.pass_rate+"%",background:"linear-gradient(90deg, "+scoreColor(exp.pass_rate)+", "+scoreColor(exp.pass_rate)+"88)"}}/></div></div></div>)}</div>;
}

function AIInsightsPanel({ analysis }: { analysis: AIAnalysis | null }) {
  const [expanded, setExpanded] = useState(false);
  if (!analysis) return null;
  return <Card style={{ padding: "20px" }} className="relative overflow-hidden"><div className="relative z-10"><div className="flex items-center gap-3 mb-4"><div className="w-8 h-8 rounded-xl bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center shadow-lg shadow-purple-500/25"><Brain className="size-4 text-white"/></div><div><h3 className="text-sm font-semibold">AI 教学分析</h3><p className="text-[10px] text-muted-foreground">智能诊断驱动</p></div><Sparkles className="size-4 text-yellow-400 ml-auto animate-pulse"/></div><p className="text-[13px] text-muted-foreground leading-relaxed mb-4">{analysis.summary}</p>{expanded && <div className="space-y-4 animate-fade-in">{analysis.error_patterns.length > 0 && <div><div className="flex items-center gap-2 mb-2"><AlertTriangle className="size-3.5 text-amber-500"/><span className="text-xs font-semibold">常见错误模式</span></div><div className="flex flex-wrap gap-2">{analysis.error_patterns.map((p,i)=><Badge key={i} variant="secondary" className="text-[11px]">{p}</Badge>)}</div></div>}{analysis.teaching_suggestions.length > 0 && <div><div className="flex items-center gap-2 mb-2"><Lightbulb className="size-3.5 text-yellow-400"/><span className="text-xs font-semibold">教学建议</span></div><ul className="space-y-1.5">{analysis.teaching_suggestions.map((s,i)=><li key={i} className="text-[12px] text-muted-foreground flex items-start gap-2"><span className="text-yellow-400 mt-0.5">▸</span> {s}</li>)}</ul></div>}{analysis.challenging_experiments.length > 0 && <div><div className="flex items-center gap-2 mb-2"><Target className="size-3.5 text-red-500"/><span className="text-xs font-semibold">最具挑战实验</span></div><div className="flex flex-wrap gap-2">{analysis.challenging_experiments.map((e,i)=><Badge key={i} variant="destructive" className="text-[11px]">{e}</Badge>)}</div></div>}</div>}<Button variant="ghost" size="sm" className="mt-3 text-[11px]" onClick={()=>setExpanded(!expanded)}>{expanded?"收起详情":"展开详情"} <ChevronRight className={"size-3 ml-1 transition-transform "+(expanded?"rotate-90":"")}/></Button></div></Card>;
}

function QuickStatsBar({ stats }: { stats: ExperimentStat[] }) {
  const tp = stats.reduce((s:number,e)=>s+e.passed_submissions,0);
  const ts = stats.reduce((s:number,e)=>s+e.total_submissions,0);
  const ae = stats.filter(e=>e.total_submissions>0).length;
  const hp = stats.filter(e=>e.pass_rate>=80).length;
  const items = [
    { label: "总通过", value: tp, icon: CheckCircle2, color: "#30D158" },
    { label: "总提交", value: ts, icon: FileCode, color: "#0A84FF" },
    { label: "活跃实验", value: ae, icon: Flame, color: "#FF9F0A" },
    { label: "高分实验", value: hp, icon: Star, color: "#BF5AF2" },
  ];
  return <div className="flex items-center justify-between flex-wrap gap-4 px-2">{items.map((item,i)=><div key={i} className="flex items-center gap-3"><div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{background:item.color+"15"}}><item.icon className="size-3.5" style={{color:item.color}}/></div><div><div className="text-lg font-bold" style={{color:item.color}}>{item.value}</div><div className="text-[10px] text-muted-foreground">{item.label}</div></div></div>)}</div>;
}

export default function TeacherDashboardPage() {
  const router = useRouter();
  const [data, setData] = useState<DashboardData|null>(null);
  const [aiAnalysis, setAiAnalysis] = useState<AIAnalysis|null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [user, setUser] = useState<any>(null);

  const fetchDashboard = useCallback(async () => { try { const res = await api.getTeacherDashboard(); setData((res as any).data || res); setError(""); } catch (e: any) { if (e?.status === 401) { router.push("/login"); return; } setError("加载失败"); } }, [router]);
  const fetchAI = useCallback(async () => { try { const res = await api.getTeacherAIAnalysis(); const d = (res as any).data || res; setAiAnalysis(d?.analysis || d); } catch {} }, []);

  useEffect(() => { const u = getUser(); if (!u || (u.role !== "teacher" && u.role !== "admin")) { router.push("/experiments"); return; } setUser(u); }, [router]);
  useEffect(() => {
    if (!user) return;
    setLoading(true);
    // 仪表盘数据先渲染，AI 分析独立异步加载，避免被后端 LLM 调用拖慢首屏
    fetchDashboard().finally(() => setLoading(false));
    fetchAI();
  }, [user, fetchDashboard, fetchAI]);

  const handleRefresh = async () => { setRefreshing(true); await Promise.all([fetchDashboard(), fetchAI()]); setTimeout(() => setRefreshing(false), 600); };
  const handleExport = () => { window.open("#", "_blank"); };

  if (!user) return null;

  if (loading) return <div className="max-w-[1400px] mx-auto px-6 py-8"><div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">{Array.from({length:4}).map((_,i)=><Skeleton key={i} className="h-28 rounded-2xl"/>)}</div><div className="grid grid-cols-1 lg:grid-cols-2 gap-4">{Array.from({length:4}).map((_,i)=><Skeleton key={i} className="h-64 rounded-2xl"/>)}</div></div>;

  return (
    <div className="max-w-[1500px] mx-auto px-4 md:px-6 py-6 animate-fade-in relative">
      <SparklesBg/>
      <div className="relative z-10 flex items-center justify-between mb-6 flex-wrap gap-4">
        <div className="flex items-center gap-4">
          <div className="relative"><div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-blue-500 via-purple-500 to-emerald-500 flex items-center justify-center shadow-xl shadow-primary/30"><GraduationCap className="size-6 text-white"/></div><div className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-emerald-500 border-2 border-background"><span className="absolute inset-0 rounded-full bg-emerald-500 animate-ping opacity-75"/></div></div>
          <div><h1 className="text-[26px] font-bold tracking-tight">{user.role==="admin"?"全局":""}教师仪表盘</h1><p className="text-sm text-muted-foreground flex items-center gap-2"><Activity className="size-3 text-emerald-500"/> 实时数据全景 · 智能分析驱动</p></div>
        </div>
        <div className="flex items-center gap-2"><Button variant="outline" size="sm" onClick={handleRefresh} disabled={refreshing} className="gap-2 text-xs"><RefreshCw className={"size-3.5 "+(refreshing?"animate-spin":"")}/> {refreshing?"刷新中...":"刷新数据"}</Button><Button variant="outline" size="sm" className="gap-2 text-xs" onClick={handleExport}><Download className="size-3.5"/> 导出报表</Button></div>
      </div>
      {error && !data && <div className="flex flex-col items-center py-20 text-muted-foreground"><AlertTriangle className="size-12 mb-4 opacity-30"/><p className="text-sm">{error}</p><Button variant="outline" size="sm" className="mt-4" onClick={handleRefresh}><RefreshCw className="size-3.5 mr-2"/> 重试</Button></div>}
      {data && <><div className="relative z-10"><OverviewCards overview={data.overview}/></div>
      <div className="relative z-10 grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="xl:col-span-2 space-y-4">
          <Card style={{ padding: "20px" }}><div className="flex items-center gap-2 mb-3"><div className="w-7 h-7 rounded-lg bg-blue-500/15 flex items-center justify-center"><TrendingUp className="size-3.5 text-blue-500"/></div><h3 className="text-sm font-semibold">实验通过率排行</h3></div>{data.experiment_stats?.length>0?<PassRateChart stats={data.experiment_stats}/>:<p className="text-[13px] text-muted-foreground text-center py-16">暂无数据</p>}</Card>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card style={{ padding: "20px" }}><div className="flex items-center gap-2 mb-3"><div className="w-7 h-7 rounded-lg bg-emerald-500/15 flex items-center justify-center"><Activity className="size-3.5 text-emerald-500"/></div><h3 className="text-sm font-semibold">提交趋势</h3></div>{data.daily_submissions?.length>0?<DailyTrendChart daily={data.daily_submissions}/>:<p className="text-[13px] text-muted-foreground text-center py-16">暂无数据</p>}</Card>
            <Card style={{ padding: "20px" }}><div className="flex items-center gap-2 mb-3"><div className="w-7 h-7 rounded-lg bg-amber-500/15 flex items-center justify-center"><Award className="size-3.5 text-amber-500"/></div><h3 className="text-sm font-semibold">分数分布</h3></div>{data.score_distribution?.length>0?<ScoreDistChart dist={data.score_distribution}/>:<p className="text-[13px] text-muted-foreground text-center py-16">暂无数据</p>}</Card>
          </div>
        </div>
        <div className="space-y-4">
          <Card style={{ padding: "20px" }}><div className="flex items-center gap-2 mb-2"><div className="w-7 h-7 rounded-lg bg-purple-500/15 flex items-center justify-center"><PieChart className="size-3.5 text-purple-500"/></div><h3 className="text-sm font-semibold">类别分布</h3></div><CategoryDonutChart stats={data.experiment_stats}/></Card>
          <Card style={{ padding: "20px" }}><div className="flex items-center gap-2 mb-3"><div className="w-7 h-7 rounded-lg bg-red-500/15 flex items-center justify-center"><AlertTriangle className="size-3.5 text-red-500"/></div><h3 className="text-sm font-semibold">困难实验</h3><Badge variant="secondary" className="ml-auto text-[10px]">通过率最低</Badge></div><DifficultCard exps={data.difficult_experiments}/></Card>
          <AIInsightsPanel analysis={aiAnalysis}/>
        </div>
      </div>
      <div className="relative z-10 mt-6 rounded-2xl border border-border/50 bg-card p-5"><QuickStatsBar stats={data.experiment_stats}/></div>
      <div className="relative z-10 mt-3 text-center text-[10px] text-muted-foreground/50"><Sparkles className="size-3 inline mr-1 opacity-50"/> 数据实时更新 · TraceOS Lab 教师仪表盘 v2.0</div></>}
    </div>
  );
}