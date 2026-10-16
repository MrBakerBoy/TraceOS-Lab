"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/api";
import { setAuthToken, setUser, removeAuthToken } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { Shield, Clock, Cpu, CpuIcon, ArrowRight, Sparkles, ChevronRight, AlertCircle } from "lucide-react";

function ParticleField() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let animId: number;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener("resize", resize);

    const particles: { x: number; y: number; vx: number; vy: number; size: number; alpha: number }[] = [];
    for (let i = 0; i < 60; i++) {
      particles.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        vx: (Math.random() - 0.5) * 0.3,
        vy: (Math.random() - 0.5) * 0.3,
        size: Math.random() * 2 + 0.5,
        alpha: Math.random() * 0.5 + 0.25,
      });
    }

    const animate = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      particles.forEach((p, i) => {
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < 0) p.x = canvas.width;
        if (p.x > canvas.width) p.x = 0;
        if (p.y < 0) p.y = canvas.height;
        if (p.y > canvas.height) p.y = 0;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(10,132,255,${p.alpha})`;
        ctx.fill();

        // Draw connections
        for (let j = i + 1; j < particles.length; j++) {
          const dx = p.x - particles[j].x;
          const dy = p.y - particles[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 120) {
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(particles[j].x, particles[j].y);
            ctx.strokeStyle = `rgba(10,132,255,${0.1 * (1 - dist / 120)})`;
            ctx.stroke();
          }
        }
      });
      animId = requestAnimationFrame(animate);
    };
    animate();

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return <canvas ref={canvasRef} className="absolute inset-0 pointer-events-none" />;
}

const features = [
  { icon: Shield, title: "三级沙箱隔离", desc: "nsjail namespace/cgroup/seccomp 精确控制，安全运行任意代码", gradient: "from-blue-500 to-cyan-400" },
  { icon: Cpu, title: "双引擎系统调用观测", desc: "strace + eBPF perf_events 全覆盖内核事件可视化", gradient: "from-purple-500 to-pink-400" },
  { icon: Sparkles, title: "AI 协同诊断", desc: "LangGraph Agent 编排 + 知识图谱推理，渐进式智能教学反馈", gradient: "from-teal-500 to-emerald-400" },
];

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  // Clear stale auth tokens to force fresh login
  useEffect(() => {
    removeAuthToken();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); setError(""); setLoading(true);
    try {
      const res = await api.login(username, password);
      setAuthToken(res.access_token); setUser(res.user);
      router.push("/experiments");
    } catch (err: any) { setError(err.message || "登录失败"); }
    finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background relative overflow-hidden">
      {/* Particle Field */}
      <ParticleField />

      {/* Morphing Blobs */}
      <div className="absolute top-[-30%] left-[-10%] w-[700px] h-[700px] rounded-full opacity-[0.18] animate-spin-slow"
        style={{ background: "radial-gradient(circle, #0A84FF, transparent 70%)" }} />
      <div className="absolute bottom-[-25%] right-[-15%] w-[600px] h-[600px] rounded-full opacity-[0.15] animate-spin-slow"
        style={{ background: "radial-gradient(circle, #BF5AF2, transparent 70%)", animationDirection: "reverse" }} />
      <div className="absolute top-[50%] left-[50%] w-[400px] h-[400px] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-[0.12] morph-blob"
        style={{ background: "radial-gradient(circle, #30D158, transparent 70%)" }} />

      {/* Grid pattern overlay */}
      <div className="absolute inset-0 pointer-events-none opacity-[0.05] hex-bg" />

      <div className="relative z-10 flex gap-20 items-start max-w-[1100px] w-full px-8 py-12 max-lg:flex-col max-lg:items-center max-lg:gap-10 max-lg:px-6">
        {/* Left: Branding */}
        <div className="flex-1 pt-10 max-lg:text-center max-lg:pt-0">
          {/* Logo */}
          <div className="mb-12 animate-fade-in">
            <div className="flex items-center gap-4 mb-4 max-lg:justify-center">
              <div className="relative">
                <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-[#0A84FF] via-[#BF5AF2] to-[#30D158] flex items-center justify-center shadow-2xl shadow-[#0A84FF]/30 glow-pulse">
                  <CpuIcon className="size-7 text-white" strokeWidth={1.8} />
                </div>
                <div className="absolute -inset-1 rounded-2xl bg-gradient-to-br from-[#0A84FF] via-[#BF5AF2] to-[#30D158] opacity-30 blur-md -z-10" />
              </div>
              <div>
                <h1 className="text-[32px] font-bold tracking-[-0.03em] leading-tight">
                  TraceOS <span className="bg-gradient-to-r from-[#0A84FF] via-[#BF5AF2] to-[#30D158] bg-clip-text text-transparent">Lab</span>
                </h1>
                <p className="text-[13px] text-muted-foreground tracking-wide uppercase mt-0.5">Operating System Laboratory</p>
              </div>
            </div>
            <p className="text-[15px] text-muted-foreground leading-relaxed max-w-[460px] max-lg:mx-auto">
              新一代操作系统在线实验平台 — 安全沙箱 · 实时系统调用追踪 · AI 驱动的智能教学体验
            </p>
          </div>

          {/* Feature Cards */}
          <div className="flex flex-col gap-3 stagger-children max-lg:items-center">
            {features.map((f, i) => (
              <div key={i}
                className="group flex items-start gap-4 p-4 rounded-xl border border-border/50 bg-card/40 backdrop-blur-xl hover:bg-card/80 hover:border-primary/20 hover:shadow-lg transition-all duration-500 max-w-[440px] card-inner-glow">
                <div className={cn("w-11 h-11 rounded-xl bg-gradient-to-br flex items-center justify-center text-white shadow-lg shrink-0 group-hover:scale-110 transition-transform duration-300", f.gradient)}>
                  <f.icon className="size-5" strokeWidth={1.8} />
                </div>
                <div>
                  <h3 className="text-[14px] font-semibold mb-1 group-hover:text-primary transition-colors">{f.title}</h3>
                  <p className="text-[12px] text-muted-foreground leading-relaxed">{f.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right: Login Form */}
        <div className="w-[400px] shrink-0 animate-fade-in-up max-lg:w-full max-lg:max-w-[440px]">
          <div className="relative">
            {/* Glow behind card */}
            <div className="absolute -inset-1 rounded-2xl bg-gradient-to-br from-[#0A84FF]/20 via-[#BF5AF2]/10 to-[#30D158]/10 blur-xl opacity-50" />
            
            <div className="relative rounded-2xl border border-border/50 bg-card/80 auth-card-gradient backdrop-blur-2xl p-8 shadow-2xl">
              {/* Kernel scan line */}
              <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-[#0A84FF]/50 via-[#BF5AF2]/50 via-[#30D158]/50 to-transparent kernel-scan rounded-t-2xl" />

              <div className="text-center mb-8">
                <h2 className="text-[26px] font-bold tracking-tight mb-2">欢迎回来</h2>
                <p className="text-sm text-muted-foreground">登录以继续你的操作系统学习之旅</p>
              </div>

              <form onSubmit={handleSubmit} className="flex flex-col gap-5">
                {error && (
                  <div className="flex items-center gap-2.5 bg-destructive/10 border border-destructive/20 text-destructive text-[13px] px-4 py-3 rounded-xl animate-fade-in">
                    <AlertCircle className="size-4 flex-shrink-0" />
                    {error}
                  </div>
                )}

                <div>
                  <Label className="text-[13px] font-medium mb-2 block">用户名或邮箱</Label>
                  <Input
                    placeholder="admin"
                    value={username}
                    onChange={e => setUsername(e.target.value)}
                    className="h-11 rounded-xl bg-muted/50 border-border/50 focus:bg-card transition-all duration-200"
                    required
                  />
                </div>

                <div>
                  <Label className="text-[13px] font-medium mb-2 block">密码</Label>
                  <Input
                    type="password"
                    placeholder="········"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    className="h-11 rounded-xl bg-muted/50 border-border/50 focus:bg-card transition-all duration-200"
                    required
                  />
                </div>

                <Button
                  type="submit"
                  size="lg"
                  className="w-full h-12 rounded-xl bg-gradient-to-r from-[#0A84FF] via-[#BF5AF2] to-[#30D158] hover:opacity-90 hover:shadow-xl hover:shadow-[#0A84FF]/25 transition-all duration-300 text-[15px] font-semibold tracking-wide mt-2 relative overflow-hidden group"
                  disabled={loading}
                >
                  <span className="relative z-10 flex items-center gap-2">
                    {loading ? "登录中..." : <><ArrowRight className="size-4 group-hover:translate-x-1 transition-transform" /> 进入平台</>}
                  </span>
                  <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-700" />
                </Button>
              </form>

              <div className="mt-6 pt-5 border-t border-border/50 text-center">
                <p className="text-[13px] text-muted-foreground">
                  还没有账号？{" "}
                  <Link href="/register" className="text-primary hover:underline font-semibold inline-flex items-center gap-1 group">
                    立即注册
                    <ChevronRight className="size-3.5 group-hover:translate-x-0.5 transition-transform" />
                  </Link>
                </p>
              </div>

              <p className="text-center text-[11px] text-muted-foreground/60 mt-5 font-mono">
                演示账号：admin / admin123
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
