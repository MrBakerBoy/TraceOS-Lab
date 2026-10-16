"use client";

import { useEffect, useState } from 'react';
import { api, type Course, type InviteCode } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import {
  Users, Plus, Copy, Check, BookOpen, Clock, GraduationCap, Hash, Key, UserPlus,
  Trash2, ChevronRight, Sparkles, Code, X
} from 'lucide-react';

interface Student { id: string; username: string; email: string; full_name?: string; }

export default function TeacherCoursesPage() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [selectedCourse, setSelectedCourse] = useState<Course | null>(null);
  const [inviteCodes, setInviteCodes] = useState<InviteCode[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [tab, setTab] = useState<'codes' | 'students'>('codes');
  const [copiedCode, setCopiedCode] = useState('');

  useEffect(() => { loadCourses(); }, []);

  const loadCourses = async () => {
    try { const res = await api.getMyCourses(); setCourses(res.data || []); }
    catch (err) { console.error(err); }
    finally { setLoading(false); }
  };

  const handleCreate = async () => {
    if (!newName.trim()) return;
    try { await api.createCourse(newName, newDesc); setNewName(''); setNewDesc(''); setShowCreate(false); loadCourses(); }
    catch (err: any) { alert(err.message || '创建失败'); }
  };

  const handleSelect = async (course: Course) => {
    setSelectedCourse(course);
    try {
      const [codesRes, studentsRes] = await Promise.all([
        api.getInviteCodes(course.id),
        api.getCourseStudents(course.id),
      ]);
      setInviteCodes(codesRes.invite_codes || []);
      setStudents(studentsRes.students || []);
    } catch (err) { console.error(err); }
  };

  const handleGenCode = async () => {
    if (!selectedCourse) return;
    try { await api.createInviteCode(selectedCourse.id); handleSelect(selectedCourse); }
    catch (err: any) { alert(err.message || '创建失败'); }
  };

  const handleCopy = (code: string) => { navigator.clipboard.writeText(code); setCopiedCode(code); setTimeout(() => setCopiedCode(''), 2000); };

  const handleDeleteCode = async (codeId: string) => {
    if (!selectedCourse || !confirm('确定删除此邀请码？')) return;
    try { await api.disableInviteCode(codeId); handleSelect(selectedCourse); }
    catch (err: any) { alert(err.message || '删除失败'); }
  };

  const handleRemoveStudent = async (studentId: string) => {
    if (!selectedCourse || !confirm('确定移除此学生？')) return;
    try { await api.removeStudentFromCourse(selectedCourse.id, studentId); handleSelect(selectedCourse); }
    catch (err: any) { alert(err.message || '移除失败'); }
  };

  return (
    <div className="p-8 animate-fade-in">
      <div className="absolute top-0 left-0 right-0 h-[2px] kernel-scan opacity-40" />

      <div className="flex items-center justify-between mb-8 flex-wrap gap-4">
        <div className="flex items-center gap-3">
          <div className="relative">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#BF5AF2] via-[#0A84FF] to-[#30D158] flex items-center justify-center shadow-lg shadow-purple-500/25">
              <Users className="size-5 text-white" strokeWidth={1.8} />
            </div>
          </div>
          <div>
            <h1 className="text-[28px] font-bold tracking-[-0.02em]">班级管理</h1>
            <p className="text-sm text-muted-foreground">管理你的教学班级、邀请码和学生</p>
          </div>
        </div>
        <Button onClick={() => setShowCreate(true)} className="rounded-xl gap-2 h-11 shadow-lg shadow-primary/20">
          <Plus className="size-4" /> 创建班级
        </Button>
      </div>

      {/* Create Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="rounded-2xl">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Sparkles className="size-5 text-primary" />创建新班级</DialogTitle></DialogHeader>
          <div className="space-y-4 mt-2">
            <div>
              <label className="text-sm font-medium mb-1.5 block">班级名称</label>
              <Input placeholder="例如：操作系统实验A班" value={newName} onChange={e => setNewName(e.target.value)}
                className="h-11 rounded-xl bg-muted/50" />
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">描述（选填）</label>
              <Input placeholder="班级简介..." value={newDesc} onChange={e => setNewDesc(e.target.value)}
                className="h-11 rounded-xl bg-muted/50" />
            </div>
            <Button onClick={handleCreate} className="w-full h-11 rounded-xl gap-2">创建</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Course Grid */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {Array.from({ length: 3 }).map((_, i) => <div key={i} className="rounded-xl border p-6"><Skeleton className="h-5 w-32 mb-3" /><Skeleton className="h-4 w-48 mb-2" /></div>)}
        </div>
      ) : courses.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-3">
          <Users className="size-12 opacity-20" />
          <p className="text-[15px]">还没有创建班级</p>
          <p className="text-xs">点击右上角创建你的第一个班级</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 stagger-children">
          {courses.map(course => (
            <div key={course.id} onClick={() => handleSelect(course)}
              className={cn(
                "group rounded-xl border border-border/50 bg-card p-6 transition-all duration-300 cursor-pointer card-inner-glow relative overflow-hidden",
                "hover:-translate-y-1.5 hover:shadow-xl hover:border-primary/20",
                selectedCourse?.id === course.id && "border-primary/50 ring-2 ring-primary/10"
              )}>
              <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-[#BF5AF2] to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />

              <div className="flex items-start gap-3 mb-4">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#BF5AF2] to-[#0A84FF] flex items-center justify-center shadow-md group-hover:scale-110 transition-transform duration-300">
                  <BookOpen className="size-5 text-white" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-[15px] font-semibold truncate">{course.name}</h3>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <Hash className="size-3 text-muted-foreground" />
                    <span className="text-[11px] text-muted-foreground font-mono">{course.code}</span>
                  </div>
                </div>
              </div>
              {course.description && <p className="text-[13px] text-muted-foreground line-clamp-2 mb-4">{course.description}</p>}
              <div className="flex items-center gap-2 text-xs text-muted-foreground pt-4 border-t border-border/30">
                <GraduationCap className="size-3.5" />
                <span className="font-medium text-foreground/70">点击管理</span>
                <ChevronRight className="size-3.5 ml-auto group-hover:translate-x-1 transition-transform" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Selected Course Detail */}
      {selectedCourse && (
        <div className="mt-8 animate-fade-in-up">
          <Card className="border-border/50 overflow-hidden">
            <div className="flex items-center justify-between p-5 border-b border-border/30 bg-muted/20">
              <div className="flex items-center gap-3">
                <GraduationCap className="size-5 text-[#BF5AF2]" />
                <div>
                  <h2 className="text-lg font-bold">{selectedCourse.name}</h2>
                  <p className="text-xs text-muted-foreground font-mono">{selectedCourse.code}</p>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <Button variant={tab === 'codes' ? 'default' : 'ghost'} size="sm" onClick={() => setTab('codes')}
                  className={cn("rounded-lg text-xs", tab === 'codes' && "shadow-md")}>
                  <Key className="size-3.5 mr-1.5" />邀请码
                </Button>
                <Button variant={tab === 'students' ? 'default' : 'ghost'} size="sm" onClick={() => setTab('students')}
                  className={cn("rounded-lg text-xs", tab === 'students' && "shadow-md")}>
                  <UserPlus className="size-3.5 mr-1.5" />学生 ({students.length})
                </Button>
              </div>
            </div>

            {tab === 'codes' && (
              <div className="p-5">
                <div className="flex items-center gap-2 mb-4">
                  <Button onClick={handleGenCode} size="sm" className="rounded-lg gap-1.5">
                    <Plus className="size-3.5" /> 生成邀请码
                  </Button>
                  <span className="text-xs text-muted-foreground">学生使用邀请码加入班级</span>
                </div>
                {inviteCodes.length === 0 ? (
                  <p className="text-center py-8 text-muted-foreground text-sm">暂无邀请码，点击上方生成</p>
                ) : (
                  <div className="space-y-2">
                    {inviteCodes.map(ic => (
                      <div key={ic.id} className="flex items-center justify-between p-4 rounded-xl border border-border/30 bg-muted/10 hover:bg-muted/20 transition-colors">
                        <div className="flex items-center gap-3">
                          <Key className="size-4 text-[#BF5AF2]" />
                          <div>
                            <code className="text-sm font-mono font-bold tracking-wider">{ic.code}</code>
                            <p className="text-[11px] text-muted-foreground mt-0.5">
                              已用 {ic.current_uses}/{ic.max_uses} · {new Date(ic.created_at).toLocaleDateString("zh-CN")}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <Badge variant={ic.is_active ? "default" : "secondary"} className="text-[10px]">
                            {ic.is_active ? "有效" : "已禁用"}
                          </Badge>
                          <Button variant="ghost" size="icon" className="size-8 rounded-lg" onClick={() => handleCopy(ic.code)}>
                            {copiedCode === ic.code ? <Check className="size-4 text-green-500" /> : <Copy className="size-4" />}
                          </Button>
                          <Button variant="ghost" size="icon" className="size-8 rounded-lg hover:text-destructive" onClick={() => handleDeleteCode(ic.id)}>
                            <Trash2 className="size-4" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {tab === 'students' && (
              <div className="p-5">
                {students.length === 0 ? (
                  <p className="text-center py-8 text-muted-foreground text-sm">暂无学生加入</p>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {students.map(s => (
                      <div key={s.id} className="flex items-center justify-between p-3 rounded-xl border border-border/30 bg-card hover:border-primary/20 transition-colors group">
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#0A84FF] to-[#BF5AF2] flex items-center justify-center text-white text-xs font-bold">
                            {(s.full_name || s.username)[0].toUpperCase()}
                          </div>
                          <div>
                            <p className="text-sm font-medium">{s.full_name || s.username}</p>
                            <p className="text-[11px] text-muted-foreground">{s.email}</p>
                          </div>
                        </div>
                        <Button variant="ghost" size="icon" className="size-8 rounded-lg opacity-0 group-hover:opacity-100 hover:text-destructive transition-all"
                          onClick={() => handleRemoveStudent(s.id)}>
                          <X className="size-3.5" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
