"use client";

import { useCallback, useEffect, useState } from "react";
import { api, type AdminUserItem } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Search, RefreshCw, UserPlus, MoreHorizontal, Pencil, KeyRound, Trash2, Power, Copy, Check,
} from "lucide-react";

type Role = "student" | "teacher" | "admin";

const roleLabel: Record<Role, string> = { student: "学生", teacher: "教师", admin: "管理员" };

function randPassword(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  let s = "";
  for (let i = 0; i < 8; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

export default function UsersPanel() {
  const [list, setList] = useState<AdminUserItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [roleFilter, setRoleFilter] = useState<string>("");
  const [classFilter, setClassFilter] = useState<string>("");
  const [q, setQ] = useState("");
  const [errMsg, setErrMsg] = useState("");

  // dialogs
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<AdminUserItem | null>(null);
  const [resetTarget, setResetTarget] = useState<AdminUserItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AdminUserItem | null>(null);
  const [result, setResult] = useState<{ password: string; username: string } | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setErrMsg("");
    api.listAdminUsers({ page, page_size: pageSize, role: roleFilter || undefined, class: classFilter || undefined, q: q || undefined })
      .then((res) => {
        setList(res.data || []);
        setTotal(res.total || 0);
        setTotalPages(res.total_pages || 0);
      })
      .catch((e: any) => setErrMsg(e?.message || "加载失败"))
      .finally(() => setLoading(false));
  }, [page, pageSize, roleFilter, classFilter, q]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [roleFilter, classFilter, q]);

  const resetAll = () => { setRoleFilter(""); setClassFilter(""); setQ(""); setPage(1); };

  return (
    <div className="space-y-4">
      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search className="size-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-9 text-xs h-8" placeholder="搜索账号/邮箱/姓名..." value={q} onChange={e => setQ(e.target.value)} />
        </div>
        <Select value={roleFilter || "all"} onValueChange={(v) => setRoleFilter(!v || v === "all" ? "" : v)}>
          <SelectTrigger className="w-[130px] h-8 text-xs"><SelectValue placeholder="全部角色" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部角色</SelectItem>
            <SelectItem value="student">学生</SelectItem>
            <SelectItem value="teacher">教师</SelectItem>
            <SelectItem value="admin">管理员</SelectItem>
          </SelectContent>
        </Select>
        <Input className="w-[130px] text-xs h-8" placeholder="班级" value={classFilter} onChange={e => setClassFilter(e.target.value)} />
        <Button size="sm" variant="ghost" onClick={resetAll} className="text-xs h-8">重置筛选</Button>
        <div className="flex-1" />
        <Button size="sm" variant="ghost" onClick={load} className="gap-1 text-xs h-8"><RefreshCw className={"size-3 " + (loading ? "animate-spin" : "")} /> 刷新</Button>
        <Button size="sm" onClick={() => setCreateOpen(true)} className="gap-1 text-xs h-8"><UserPlus className="size-3.5" /> 新建用户</Button>
      </div>

      {errMsg && <div className="text-xs text-red-500">{errMsg}</div>}

      {/* list */}
      {loading ? (
        <div className="space-y-2">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-14 rounded-xl" />)}</div>
      ) : list.length === 0 ? (
        <p className="text-center text-muted-foreground py-12 text-xs">暂无用户</p>
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
                  <Badge variant="secondary" className="text-[10px]">{roleLabel[u.role as Role] || u.role}</Badge>
                  {u.role === "student" && u.class_name && <Badge variant="outline" className="text-[10px]">{u.class_name}</Badge>}
                  {u.role === "teacher" && (u.teaching_classes?.length || 0) > 0 &&
                    <span className="text-[10px] text-muted-foreground truncate">所带：{(u.teaching_classes ?? []).join("、")}</span>}
                </div>
                <div className="text-[11px] text-muted-foreground truncate">
                  {u.username} · {u.email || "-"}
                  {u.role === "student" && u.student_no ? ` · 学号 ${u.student_no}` : ""}
                </div>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <div className="text-right">
                  <div className="text-xs font-bold">{u.total_submissions || 0}</div>
                  <div className="text-[9px] text-muted-foreground">提交</div>
                </div>
                <div className="text-right">
                  <div className="text-xs font-bold" style={{ color: (u.avg_score || 0) >= 60 ? "#30D158" : "#FF9F0A" }}>
                    {typeof u.avg_score === "number" ? u.avg_score.toFixed(1) : "0.0"}%
                  </div>
                  <div className="text-[9px] text-muted-foreground">均分</div>
                </div>
                <div className={"w-2 h-2 rounded-full " + (u.is_online ? "bg-emerald-500" : "bg-muted-foreground/30")}
                  title={u.is_online ? "在线" : "离线"} />
                <DropdownMenu>
                  <DropdownMenuTrigger
                  render={
                    <Button size="sm" variant="ghost" className="h-8 w-8 p-0">
                      <MoreHorizontal className="size-4" />
                    </Button>
                  }
                />
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => setEditTarget(u)}><Pencil className="size-3.5 mr-2" /> 编辑</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setResetTarget(u)}><KeyRound className="size-3.5 mr-2" /> 重置密码</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => api.setAdminUserStatus(u.id, !u.is_active).then(load).catch(() => {})}>
                      <Power className="size-3.5 mr-2" /> {u.is_active ? "禁用" : "启用"}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem className="text-red-600" onClick={() => setDeleteTarget(u)}><Trash2 className="size-3.5 mr-2" /> 删除</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* pagination */}
      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
        <span>共 {total} 条 · 第 {page}/{Math.max(totalPages, 1)} 页</span>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="h-7 text-xs">上一页</Button>
          <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)} className="h-7 text-xs">下一页</Button>
        </div>
      </div>

      {createOpen && (
        <CreateUserDialog
          onClose={() => setCreateOpen(false)}
          onCreated={(r) => { setCreateOpen(false); setResult(r); load(); }}
        />
      )}
      {editTarget && (
        <EditUserDialog
          user={editTarget}
          onClose={() => setEditTarget(null)}
          onSaved={() => { setEditTarget(null); load(); }}
        />
      )}
      {resetTarget && (
        <ResetPasswordDialog
          user={resetTarget}
          onClose={() => setResetTarget(null)}
        />
      )}
      {deleteTarget && (
        <DeleteDialog
          user={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onDeleted={() => { setDeleteTarget(null); load(); }}
        />
      )}
      {result && (
        <Dialog open onOpenChange={o => { if (!o) setResult(null); }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>用户创建成功</DialogTitle>
              <DialogDescription>请复制初始密码并线下转告用户，此密码仅展示一次。</DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <div className="text-xs text-muted-foreground">账号：<span className="font-mono">{result.username}</span></div>
              <div className="flex items-center gap-2">
                <Input readOnly value={result.password} className="font-mono" />
                <CopyButton value={result.password} />
              </div>
            </div>
            <DialogFooter><Button onClick={() => setResult(null)}>我已保存</Button></DialogFooter>
          </DialogContent>
        </Dialog>
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

function CreateUserDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (r: { password: string; username: string }) => void }) {
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState<Role>("student");
  const [password, setPassword] = useState("");
  const [auto, setAuto] = useState(true);
  const [studentNo, setStudentNo] = useState("");
  const [className, setClassName] = useState("");
  const [teachingClasses, setTeachingClasses] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = () => {
    setErr("");
    if (username.length < 2) return setErr("用户名至少 2 个字符");
    if (!email.includes("@")) return setErr("邮箱格式不正确");
    if (role === "student" && (!studentNo || !className)) return setErr("学生必须填写学号和班级");
    if (role === "teacher" && !teachingClasses.trim()) return setErr("教师至少填写一个所带班级");
    if (!auto && (password.length < 6 || password.length > 128)) return setErr("密码需 6-128 个字符");
    setBusy(true);
    const pw = auto ? undefined : password;
    api.createAdminUser({
      username, email, password: pw, full_name: fullName || undefined, role,
      student_no: role === "student" ? studentNo : undefined,
      class_name: role === "student" ? className : undefined,
      teaching_classes: role === "teacher" ? teachingClasses.split(/[,，、\s]+/).filter(Boolean) : undefined,
    })
      .then((res: any) => onCreated({ password: res.initial_password, username }))
      .catch((e: any) => setErr(e?.message || "创建失败"))
      .finally(() => setBusy(false));
  };

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>新建用户</DialogTitle><DialogDescription>一键创建平台账号并设置初始密码</DialogDescription></DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div><Label className="text-xs">账号 *</Label><Input className="h-8 text-xs" value={username} onChange={e => setUsername(e.target.value)} placeholder="登录用户名" /></div>
            <div><Label className="text-xs">邮箱 *</Label><Input className="h-8 text-xs" value={email} onChange={e => setEmail(e.target.value)} placeholder="user@example.com" /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label className="text-xs">姓名</Label><Input className="h-8 text-xs" value={fullName} onChange={e => setFullName(e.target.value)} /></div>
            <div><Label className="text-xs">角色</Label>
              <Select value={role} onValueChange={v => setRole(v as Role)}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="student">学生</SelectItem>
                  <SelectItem value="teacher">教师</SelectItem>
                  <SelectItem value="admin">管理员</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          {role === "student" && (
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs">学号 *</Label><Input className="h-8 text-xs" value={studentNo} onChange={e => setStudentNo(e.target.value)} /></div>
              <div><Label className="text-xs">班级 *</Label><Input className="h-8 text-xs" value={className} onChange={e => setClassName(e.target.value)} /></div>
            </div>
          )}
          {role === "teacher" && (
            <div><Label className="text-xs">所带班级 *（逗号分隔，如：CS101,CS102）</Label>
              <Input className="h-8 text-xs" value={teachingClasses} onChange={e => setTeachingClasses(e.target.value)} placeholder="CS101,CS102" />
            </div>
          )}
          <div className="flex items-center gap-3">
            <Switch checked={auto} onCheckedChange={setAuto} id="auto" />
            <Label htmlFor="auto" className="text-xs">随机生成初始密码</Label>
          </div>
          {!auto && <div><Label className="text-xs">初始密码 *</Label><Input className="h-8 text-xs" value={password} onChange={e => setPassword(e.target.value)} placeholder="6-128 位" /></div>}
          {err && <div className="text-xs text-red-500">{err}</div>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button disabled={busy} onClick={submit}>{busy ? "创建中..." : "创建"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditUserDialog({ user, onClose, onSaved }: { user: AdminUserItem; onClose: () => void; onSaved: () => void }) {
  const [email, setEmail] = useState(user.email);
  const [fullName, setFullName] = useState(user.full_name || "");
  const [role, setRole] = useState<Role>(user.role as Role);
  const [studentNo, setStudentNo] = useState(user.student_no || "");
  const [className, setClassName] = useState(user.class_name || "");
  const [teachingClasses, setTeachingClasses] = useState((user.teaching_classes || []).join("、"));
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = () => {
    setErr(""); setBusy(true);
    api.updateAdminUser(user.id, {
      email, full_name: fullName, role,
      student_no: role === "student" ? studentNo : undefined,
      class_name: role === "student" ? className : undefined,
      teaching_classes: role === "teacher" ? teachingClasses.split(/[,，、\s]+/).filter(Boolean) : undefined,
    })
      .then(onSaved)
      .catch((e: any) => setErr(e?.message || "保存失败"))
      .finally(() => setBusy(false));
  };

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>编辑用户</DialogTitle><DialogDescription>账号 {user.username} 不可修改</DialogDescription></DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div><Label className="text-xs">邮箱</Label><Input className="h-8 text-xs" value={email} onChange={e => setEmail(e.target.value)} /></div>
            <div><Label className="text-xs">姓名</Label><Input className="h-8 text-xs" value={fullName} onChange={e => setFullName(e.target.value)} /></div>
          </div>
          <div>
            <Label className="text-xs">角色</Label>
            <Select value={role} onValueChange={v => setRole(v as Role)}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="student">学生</SelectItem>
                <SelectItem value="teacher">教师</SelectItem>
                <SelectItem value="admin">管理员</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {role === "student" && (
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs">学号</Label><Input className="h-8 text-xs" value={studentNo} onChange={e => setStudentNo(e.target.value)} /></div>
              <div><Label className="text-xs">班级</Label><Input className="h-8 text-xs" value={className} onChange={e => setClassName(e.target.value)} /></div>
            </div>
          )}
          {role === "teacher" && (
            <div><Label className="text-xs">所带班级（逗号/顿号分隔）</Label>
              <Input className="h-8 text-xs" value={teachingClasses} onChange={e => setTeachingClasses(e.target.value)} />
            </div>
          )}
          {err && <div className="text-xs text-red-500">{err}</div>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button disabled={busy} onClick={submit}>{busy ? "保存中..." : "保存"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ResetPasswordDialog({ user, onClose }: { user: AdminUserItem; onClose: () => void }) {
  const [password, setPassword] = useState("");
  const [auto, setAuto] = useState(true);
  const [done, setDone] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (auto) setPassword(randPassword()); }, [auto]);

  const submit = () => {
    setErr(""); setBusy(true);
    api.resetAdminUserPassword(user.id, password)
      .then(() => setDone(password))
      .catch((e: any) => setErr(e?.message || "重置失败"))
      .finally(() => setBusy(false));
  };

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>重置密码 — {user.username}</DialogTitle>
          <DialogDescription>{done ? "密码已重置，请转告用户" : "设置新密码后线下告知用户"}</DialogDescription>
        </DialogHeader>
        {done ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Input readOnly value={done} className="font-mono" />
              <CopyButton value={done} />
            </div>
            <Button className="w-full" onClick={onClose}>完成</Button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <Switch checked={auto} onCheckedChange={setAuto} id="auto2" />
              <Label htmlFor="auto2" className="text-xs">随机生成</Label>
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

function DeleteDialog({ user, onClose, onDeleted }: { user: AdminUserItem; onClose: () => void; onDeleted: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const submit = () => {
    setErr(""); setBusy(true);
    api.deleteAdminUser(user.id).then(onDeleted).catch((e: any) => setErr(e?.message || "删除失败")).finally(() => setBusy(false));
  };
  return (
    <Dialog open onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>删除用户</DialogTitle><DialogDescription>此操作不可撤销，将永久删除该账号及其关联数据。</DialogDescription></DialogHeader>
        <div className="text-xs text-muted-foreground">确认删除 <span className="font-medium">{user.full_name || user.username}</span>（{user.username}）？</div>
        {err && <div className="text-xs text-red-500">{err}</div>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button variant="destructive" disabled={busy} onClick={submit}>{busy ? "删除中..." : "永久删除"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
