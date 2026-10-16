"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, type AdminUserItem } from "@/lib/api";
import { getUser } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Search, RefreshCw, KeyRound, Copy, Check } from "lucide-react";

function randPassword(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  let s = "";
  for (let i = 0; i < 8; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

export default function TeacherStudentsPage() {
  const router = useRouter();
  const [list, setList] = useState<AdminUserItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");
  const [resetTarget, setResetTarget] = useState<AdminUserItem | null>(null);
  const [err, setErr] = useState("");

  const load = () => {
    setLoading(true); setErr("");
    api.listMyStudents({ page: 1, page_size: 50, q: q || undefined })
      .then((res: any) => setList((res.data || res).data || []))
      .catch((e: any) => setErr(e?.message || "加载失败"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    const u = getUser();
    if (!u || (u.role !== "teacher" && u.role !== "admin")) { router.push("/experiments"); return; }
    load();
  }, [router]);

  return (
    <div className="px-4 md:px-6 py-6 animate-fade-in space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold">我的学生（按所带班级）</h2>
        <div className="relative flex-1 max-w-xs">
          <Search className="size-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-9 text-xs h-8" placeholder="搜索账号/邮箱/姓名..." value={q} onChange={e => setQ(e.target.value)} />
        </div>
        <Button size="sm" variant="ghost" onClick={load} className="gap-1 text-xs h-8"><RefreshCw className={"size-3 " + (loading ? "animate-spin" : "")} /> 刷新</Button>
      </div>

      {err && <div className="text-xs text-red-500">{err}</div>}

      {loading ? (
        <div className="space-y-2">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-14 rounded-xl" />)}</div>
      ) : list.length === 0 ? (
        <p className="text-center text-muted-foreground py-12 text-xs">暂无可管学生（请先由管理员为你设置“所带班级”并将学生分配到对应班级）</p>
      ) : (
        <div className="grid gap-2">
          {list.map(u => (
            <div key={u.id} className="flex items-center gap-3 p-3 rounded-xl border border-border/40 bg-card hover:border-border/80 transition-all">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500/20 to-purple-500/20 flex items-center justify-center text-sm font-bold shrink-0">
                {(u.full_name || u.username || "?")[0]}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium truncate">{u.full_name || u.username}</span>
                  {u.class_name && <Badge variant="outline" className="text-[10px]">{u.class_name}</Badge>}
                </div>
                <div className="text-[11px] text-muted-foreground truncate">
                  {u.username} · {u.email || "-"}{u.student_no ? ` · 学号 ${u.student_no}` : ""}
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className="text-xs font-bold">{u.total_submissions || 0}</div>
                <div className="text-[9px] text-muted-foreground">提交</div>
              </div>
              <div className="text-right shrink-0">
                <div className="text-xs font-bold" style={{ color: (u.avg_score || 0) >= 60 ? "#30D158" : "#FF9F0A" }}>
                  {typeof u.avg_score === "number" ? u.avg_score.toFixed(1) : "0.0"}%
                </div>
                <div className="text-[9px] text-muted-foreground">均分</div>
              </div>
              <Button size="sm" variant="outline" onClick={() => setResetTarget(u)} className="gap-1 text-xs h-8"><KeyRound className="size-3.5" /> 重置密码</Button>
            </div>
          ))}
        </div>
      )}

      {resetTarget && (
        <TeacherResetDialog user={resetTarget} onClose={() => setResetTarget(null)} />
      )}
    </div>
  );
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button size="sm" variant="outline" onClick={() => { navigator.clipboard?.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
    </Button>
  );
}

function TeacherResetDialog({ user, onClose }: { user: AdminUserItem; onClose: () => void }) {
  const [password, setPassword] = useState(randPassword());
  const [auto, setAuto] = useState(true);
  const [done, setDone] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = () => {
    setErr(""); setBusy(true);
    api.resetMyStudentPassword(user.id, password)
      .then(() => setDone(password))
      .catch((e: any) => setErr(e?.message || "重置失败"))
      .finally(() => setBusy(false));
  };

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>重置学生密码 — {user.username}</DialogTitle>
          <DialogDescription>{done ? "密码已重置，请转告学生" : "仅可重置本班学生密码"}</DialogDescription>
        </DialogHeader>
        {done ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2"><Input readOnly value={done} className="font-mono" /><CopyButton value={done} /></div>
            <Button className="w-full" onClick={onClose}>完成</Button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <Switch checked={auto} onCheckedChange={a => { setAuto(a); if (a) setPassword(randPassword()); }} id="tauto" />
              <Label htmlFor="tauto" className="text-xs">随机生成</Label>
            </div>
            <div><Label className="text-xs">新密码 *</Label>
              <div className="flex gap-2">
                <Input className="h-8 text-xs font-mono" value={password} onChange={e => setPassword(e.target.value)} />
                {!auto && <Button size="sm" variant="outline" onClick={() => setPassword(randPassword())}>换一个</Button>}
              </div>
            </div>
            {err && <div className="text-xs text-red-500">{err}</div>}
            <DialogFooter>
              <Button variant="outline" onClick={onClose}>取消</Button>
              <Button disabled={busy} onClick={submit}>{busy ? "重置中..." : "确认重置"}</Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
