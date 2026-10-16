"use client";

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import {
  GraduationCap, Users, Clock, BookOpen, Search, ArrowRight, Sparkles, Calendar, Hash, CheckCircle2, AlertCircle
} from 'lucide-react';

interface Course {
  id: string; code: string; name: string; description?: string; created_at: string;
  student_count?: number; experiment_count?: number;
}

export default function StudentCoursesPage() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);
  const [inviteCode, setInviteCode] = useState('');
  const [joinError, setJoinError] = useState('');
  const [joinSuccess, setJoinSuccess] = useState('');

  useEffect(() => { loadCourses(); }, []);

  const loadCourses = async () => {
    try {
      const res = await api.getMyCourses();
      setCourses(res.data || []);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  };

  const handleJoin = async () => {
    if (!inviteCode.trim()) return;
    setJoining(true); setJoinError(''); setJoinSuccess('');
    try {
      await api.joinCourse(inviteCode.trim());
      setJoinSuccess('加入成功！');
      setInviteCode('');
      loadCourses();
    } catch (err: any) {
      setJoinError(err.message || '加入失败，请检查邀请码');
    } finally { setJoining(false); }
  };

  return (
    <div className="p-8 animate-fade-in">
      <div className="absolute top-0 left-0 right-0 h-[2px] kernel-scan opacity-40" />

      <div className="flex items-center gap-3 mb-8">
        <div className="relative">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#30D158] via-[#0A84FF] to-[#BF5AF2] flex items-center justify-center shadow-lg shadow-green-500/25">
            <GraduationCap className="size-5 text-white" strokeWidth={1.8} />
          </div>
        </div>
        <div>
          <h1 className="text-[28px] font-bold tracking-[-0.02em]">我的班级</h1>
          <p className="text-sm text-muted-foreground">加入班级，与同学一起学习操作系统实验</p>
        </div>
      </div>

      {/* Join Course Card */}
      <Card className="border-border/50 mb-8 bg-gradient-to-r from-primary/5 via-purple-500/5 to-teal-500/5">
        <CardContent className="p-5">
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex-1 min-w-[200px]">
              <h3 className="text-sm font-semibold mb-1 flex items-center gap-1.5">
                <Sparkles className="size-4 text-primary" /> 加入新班级
              </h3>
              <p className="text-xs text-muted-foreground">输入老师提供的邀请码加入班级</p>
            </div>
            <div className="flex items-center gap-2 flex-1 min-w-[280px]">
              <Input placeholder="输入邀请码..." value={inviteCode} onChange={e => setInviteCode(e.target.value)}
                className="h-10 rounded-xl bg-muted/50 border-border/50 focus:bg-card transition-all font-mono tracking-wider text-center"
                onKeyDown={e => e.key === 'Enter' && handleJoin()} />
              <Button onClick={handleJoin} disabled={joining} size="sm" className="h-10 rounded-xl gap-1.5">
                {joining ? "加入中..." : <><ArrowRight className="size-4" /> 加入</>}
              </Button>
            </div>
          </div>
          {joinError && <p className="mt-2 text-xs text-destructive flex items-center gap-1"><AlertCircle className="size-3" />{joinError}</p>}
          {joinSuccess && <p className="mt-2 text-xs text-green-500 flex items-center gap-1"><CheckCircle2 className="size-3" />{joinSuccess}</p>}
        </CardContent>
      </Card>

      {/* Course Grid */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-border/50 bg-card p-6"><Skeleton className="h-5 w-32 mb-3" /><Skeleton className="h-4 w-48 mb-2" /><Skeleton className="h-3 w-24" /></div>
          ))}
        </div>
      ) : courses.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-3">
          <GraduationCap className="size-12 opacity-20" />
          <p className="text-[15px]">还没有加入任何班级</p>
          <p className="text-xs">输入老师的邀请码加入你的第一个班级</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 stagger-children">
          {courses.map(course => (
            <div key={course.id}
              className="group rounded-xl border border-border/50 bg-card p-6 transition-all duration-300 hover:-translate-y-1.5 hover:shadow-xl hover:border-primary/20 card-inner-glow relative overflow-hidden">
              <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-[#30D158] to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />

              <div className="flex items-start gap-3 mb-4">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#30D158] to-[#0A84FF] flex items-center justify-center shadow-md group-hover:scale-110 transition-transform duration-300 flex-shrink-0">
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

              {course.description && (
                <p className="text-[13px] text-muted-foreground line-clamp-2 mb-4">{course.description}</p>
              )}

              <div className="flex items-center gap-3 text-xs text-muted-foreground pt-4 border-t border-border/30">
                <span className="flex items-center gap-1"><Users className="size-3.5" /> {course.student_count || 0} 人</span>
                <span className="w-px h-3 bg-border" />
                <span className="flex items-center gap-1"><BookOpen className="size-3.5" /> {course.experiment_count || 0} 实验</span>
                <span className="w-px h-3 bg-border" />
                <span className="flex items-center gap-1"><Calendar className="size-3.5" /> {new Date(course.created_at).toLocaleDateString("zh-CN")}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
