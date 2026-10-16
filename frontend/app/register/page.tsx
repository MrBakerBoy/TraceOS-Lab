"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  ArrowLeft, UserPlus, User, Mail, Lock, AlertCircle,
  Sparkles, ChevronRight, GraduationCap, Briefcase,
} from "lucide-react";

type Role = "student" | "teacher";

export default function RegisterPage() {
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [role, setRole] = useState<Role>("student");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); setError("");
    if (password !== confirmPassword) { setError("\u4e24\u6b21\u8f93\u5165\u7684\u5bc6\u7801\u4e0d\u4e00\u81f4"); return; }
    if (password.length < 6) { setError("\u5bc6\u7801\u81f3\u5c11\u9700\u8981 6 \u4f4d\u5b57\u7b26"); return; }
    setLoading(true);
    try {
      await api.register(username, email, password, role, fullName || undefined);
      router.push("/login?registered=true");
    } catch (err: any) { setError(err.message || "\u6ce8\u518c\u5931\u8d25"); }
    finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background relative overflow-hidden">
      {/* Background decorations */}
      <div className="absolute top-[-15%] right-[-5%] w-[600px] h-[600px] rounded-full opacity-[0.16] animate-spin-slow"
        style={{ background: "radial-gradient(circle, #BF5AF2, transparent 70%)" }} />
      <div className="absolute bottom-[-20%] left-[-10%] w-[500px] h-[500px] rounded-full opacity-[0.14] animate-spin-slow"
        style={{ background: "radial-gradient(circle, #30D158, transparent 70%)", animationDirection: "reverse" }} />
      <div className="absolute inset-0 pointer-events-none opacity-[0.04] hex-bg" />

      <div className="relative z-10 w-[460px] max-w-[calc(100vw-40px)] animate-fade-in-up">
        <div className="relative">
          <div className="absolute -inset-1 rounded-2xl bg-gradient-to-br from-[#0A84FF]/15 via-[#BF5AF2]/10 to-[#30D158]/10 blur-xl opacity-60" />

          <div className="relative rounded-2xl border border-border/50 bg-card/80 auth-card-gradient backdrop-blur-2xl p-8 shadow-2xl">
            <div className="absolute top-0 left-0 right-0 h-[2px] kernel-scan rounded-t-2xl" />

            <Link href="/login" className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground transition-colors mb-6 group">
              <ArrowLeft className="size-4 group-hover:-translate-x-1 transition-transform" /> {"\u8fd4\u56de\u767b\u5f55"}
            </Link>

            <div className="text-center mb-7">
              <div className="relative inline-block mb-4">
                <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-[#0A84FF] via-[#BF5AF2] to-[#30D158] flex items-center justify-center shadow-xl shadow-primary/30">
                  <UserPlus className="size-7 text-white" strokeWidth={1.8} />
                </div>
              </div>
              <h2 className="text-[26px] font-bold tracking-tight mb-1">{"\u521b\u5efa\u8d26\u53f7"}</h2>
              <p className="text-sm text-muted-foreground">{"\u52a0\u5165 TraceOS Lab \u5f00\u59cb\u5185\u6838\u63a2\u7d22\u4e4b\u65c5"}</p>
            </div>

            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              {error && (
                <div className="flex items-center gap-2.5 bg-destructive/10 border border-destructive/20 text-destructive text-[13px] px-4 py-3 rounded-xl animate-fade-in">
                  <AlertCircle className="size-4 flex-shrink-0" />{error}
                </div>
              )}

              {/* ---- Role Selector ---- */}
              <div>
                <Label className="text-[13px] font-medium mb-2 block">{"\u8eab\u4efd\u9009\u62e9"}</Label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setRole("student")}
                    className={cn(
                      "flex items-center gap-2.5 px-4 py-3 rounded-xl border-2 text-[13px] font-medium transition-all duration-200",
                      role === "student"
                        ? "border-[#0A84FF] bg-[#0A84FF]/8 text-[#0A84FF] shadow-sm shadow-[#0A84FF]/10"
                        : "border-border/50 bg-muted/30 text-muted-foreground hover:border-border hover:text-foreground"
                    )}>
                    <GraduationCap className="size-4.5" />
                    <div className="text-left">
                      <p className="font-semibold">{"\u5b66\u751f"}</p>
                      <p className="text-[10px] opacity-70">{"\u5b66\u4e60\u5b9e\u9a8c\u8bfe\u7a0b"}</p>
                    </div>
                    {role === "student" && (
                      <div className="ml-auto w-5 h-5 rounded-full bg-[#0A84FF] flex items-center justify-center">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                      </div>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => setRole("teacher")}
                    className={cn(
                      "flex items-center gap-2.5 px-4 py-3 rounded-xl border-2 text-[13px] font-medium transition-all duration-200",
                      role === "teacher"
                        ? "border-[#BF5AF2] bg-[#BF5AF2]/8 text-[#BF5AF2] shadow-sm shadow-[#BF5AF2]/10"
                        : "border-border/50 bg-muted/30 text-muted-foreground hover:border-border hover:text-foreground"
                    )}>
                    <Briefcase className="size-4.5" />
                    <div className="text-left">
                      <p className="font-semibold">{"\u6559\u5e08"}</p>
                      <p className="text-[10px] opacity-70">{"\u7ba1\u7406\u5b66\u751f\u4e0e\u5b9e\u9a8c"}</p>
                    </div>
                    {role === "teacher" && (
                      <div className="ml-auto w-5 h-5 rounded-full bg-[#BF5AF2] flex items-center justify-center">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                      </div>
                    )}
                  </button>
                </div>
              </div>

              <div>
                <Label className="text-[13px] font-medium mb-1.5 block">{"\u7528\u6237\u540d"}</Label>
                <Input placeholder={"\u9009\u62e9\u7528\u6237\u540d"} value={username} onChange={e => setUsername(e.target.value)}
                  className="h-11 rounded-xl bg-muted/50 border-border/50 focus:bg-card transition-all" required />
              </div>
              <div>
                <Label className="text-[13px] font-medium mb-1.5 block">{"\u7535\u5b50\u90ae\u7bb1"}</Label>
                <Input type="email" placeholder="your@email.com" value={email} onChange={e => setEmail(e.target.value)}
                  className="h-11 rounded-xl bg-muted/50 border-border/50 focus:bg-card transition-all" required />
              </div>
              <div>
                <Label className="text-[13px] font-medium mb-1.5 block">{"\u59d3\u540d\uff08\u9009\u586b\uff09"}</Label>
                <Input placeholder={"\u4f60\u7684\u59d3\u540d"} value={fullName} onChange={e => setFullName(e.target.value)}
                  className="h-11 rounded-xl bg-muted/50 border-border/50 focus:bg-card transition-all" />
              </div>
              <div>
                <Label className="text-[13px] font-medium mb-1.5 block">{"\u5bc6\u7801"}</Label>
                <Input type="password" placeholder={"\u81f3\u5c11 6 \u4f4d\u5b57\u7b26"} value={password} onChange={e => setPassword(e.target.value)}
                  className="h-11 rounded-xl bg-muted/50 border-border/50 focus:bg-card transition-all" required minLength={6} />
              </div>
              <div>
                <Label className="text-[13px] font-medium mb-1.5 block">{"\u786e\u8ba4\u5bc6\u7801"}</Label>
                <Input type="password" placeholder={"\u518d\u6b21\u8f93\u5165\u5bc6\u7801"} value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)}
                  className="h-11 rounded-xl bg-muted/50 border-border/50 focus:bg-card transition-all" required />
              </div>
              <Button type="submit" size="lg"
                className="w-full h-12 rounded-xl bg-gradient-to-r from-[#0A84FF] via-[#BF5AF2] to-[#30D158] hover:opacity-90 hover:shadow-xl hover:shadow-primary/25 transition-all duration-300 text-[15px] font-semibold mt-2 relative overflow-hidden group"
                disabled={loading}>
                <span className="relative z-10 flex items-center gap-2">
                  {loading ? "\u6ce8\u518c\u4e2d..." : <><Sparkles className="size-4" /> {"\u521b\u5efa\u8d26\u53f7"}</>}
                </span>
                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-700" />
              </Button>
            </form>

            <div className="mt-6 pt-5 border-t border-border/50 text-center">
              <p className="text-[13px] text-muted-foreground">
                {"\u5df2\u6709\u8d26\u53f7\uff1f"} <Link href="/login" className="text-primary hover:underline font-semibold inline-flex items-center gap-1 group">
                  {"\u7acb\u5373\u767b\u5f55"} <ChevronRight className="size-3.5 group-hover:translate-x-0.5 transition-transform" />
                </Link>
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}