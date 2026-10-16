"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import RichTextEditor from "@/components/ui/RichTextEditor";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { showToast } from "@/components/ui/Toast";
import { cn } from "@/lib/utils";
import {
  FlaskConical, ArrowLeft, Save, Sparkles, Cpu, Zap, Brain,
  HardDrive, Timer, Lock, ChevronRight
} from "lucide-react";

const CATEGORIES = [
  { value: "process", label: "进程管理", icon: Cpu, gradient: "from-blue-500 to-cyan-400" },
  { value: "thread", label: "线程并发", icon: Zap, gradient: "from-purple-500 to-pink-400" },
  { value: "memory", label: "内存管理", icon: Brain, gradient: "from-teal-500 to-emerald-400" },
  { value: "fs", label: "文件系统", icon: HardDrive, gradient: "from-amber-500 to-orange-400" },
  { value: "scheduler", label: "进程调度", icon: Timer, gradient: "from-red-500 to-rose-400" },
  { value: "deadlock", label: "死锁检测", icon: Lock, gradient: "from-pink-500 to-fuchsia-400" },
];

const DIFFICULTIES = [
  { value: "easy", label: "入门" },
  { value: "medium", label: "进阶" },
  { value: "hard", label: "挑战" },
];

export default function CreateExperimentPage() {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [courses, setCourses] = useState<{ id: string; name: string }[]>([]);

  const [form, setForm] = useState({
    name: "",
    title: "",
    category: "process",
    difficulty: "medium",
    description: "",
    instructions: "",
    starter_code: "",
    reference_solution: "",
    answer_explanation: "",
    course_id: "",
    time_limit: 300,
    memory_limit: 268435456,
    sandbox_level: 1,
    max_submissions: 100,
    is_published: false,
  });

  useEffect(() => {
    api.getMyCourses().then(res => {
      if (res.data) setCourses(res.data as any[]);
    }).catch(() => {});
  }, []);

  const update = (key: string, value: any) => setForm(prev => ({ ...prev, [key]: value }));

  const handleSave = async () => {
    if (!form.name.trim() || !form.title.trim()) {
      showToast("error", "实验名称和标题不能为空");
      return;
    }
    setSaving(true);
    try {
      const payload: any = {
        name: form.name.trim(),
        title: form.title.trim(),
        category: form.category,
        difficulty: form.difficulty,
        time_limit: form.time_limit,
        memory_limit: form.memory_limit,
        sandbox_level: form.sandbox_level,
        max_submissions: form.max_submissions,
        is_published: form.is_published,
      };
      if (form.description.trim()) payload.description = form.description.trim();
      if (form.instructions.trim()) payload.instructions = form.instructions.trim();
      if (form.starter_code.trim()) payload.starter_code = form.starter_code.trim();
      if (form.reference_solution.trim()) payload.reference_solution = form.reference_solution.trim();
      if (form.answer_explanation.trim()) payload.answer_explanation = form.answer_explanation.trim();
      if (form.course_id) payload.course_id = form.course_id;

      const exp = await api.createExperiment(payload);
      showToast("success", "实验创建成功");
      router.push(`/teacher/experiments/${exp.id}/edit`);
    } catch (err: any) {
      showToast("error", err?.message || "创建失败");
    } finally {
      setSaving(false);
    }
  };

  const catInfo = CATEGORIES.find(c => c.value === form.category) || CATEGORIES[0];
  const CatIcon = catInfo.icon;

  return (
    <div className="p-8 animate-fade-in max-w-5xl mx-auto">
      <div className="absolute top-0 left-0 right-0 h-[2px] kernel-scan opacity-40" />

      {/* Header */}
      <div className="flex items-center justify-between mb-8 flex-wrap gap-4">
        <div className="flex items-center gap-3">
          <button onClick={() => router.back()} className="p-2 rounded-xl hover:bg-muted transition-colors">
            <ArrowLeft className="size-5 text-muted-foreground" />
          </button>
          <div className="relative">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#0A84FF] via-[#BF5AF2] to-[#30D158] flex items-center justify-center shadow-lg shadow-blue-500/25">
              <FlaskConical className="size-5 text-white" strokeWidth={1.8} />
            </div>
          </div>
          <div>
            <h1 className="text-[28px] font-bold tracking-[-0.02em]">创建实验</h1>
            <p className="text-sm text-muted-foreground">填写实验信息并保存</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" onClick={() => router.back()} className="rounded-xl h-11">
            取消
          </Button>
          <Button onClick={handleSave} disabled={saving} className="rounded-xl gap-2 h-11 shadow-lg shadow-primary/20">
            <Save className="size-4" /> {saving ? "保存中..." : "保存实验"}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column - Basic Info */}
        <div className="lg:col-span-2 space-y-6">
          {/* Basic Info Card */}
          <div className="rounded-xl border border-border/50 bg-card p-6 space-y-5">
            <h2 className="text-[15px] font-semibold flex items-center gap-2">
              <div className={cn("w-6 h-6 rounded-lg bg-gradient-to-br flex items-center justify-center", catInfo.gradient)}>
                <CatIcon className="size-3.5 text-white" />
              </div>
              基本信息
            </h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5 block">实验名称 (英文标识)</Label>
                <Input
                  placeholder="例如: lab1_fork_basic"
                  value={form.name}
                  onChange={e => update("name", e.target.value)}
                  className="h-10 rounded-xl bg-muted/50 border-border/50"
                />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5 block">实验标题</Label>
                <Input
                  placeholder="例如: 进程创建与父子关系"
                  value={form.title}
                  onChange={e => update("title", e.target.value)}
                  className="h-10 rounded-xl bg-muted/50 border-border/50"
                />
              </div>
            </div>

            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">分类</Label>
              <div className="flex gap-1.5 flex-wrap">
                {CATEGORIES.map(cat => (
                  <button key={cat.value} type="button" onClick={() => update("category", cat.value)}
                    className={cn(
                      "flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-xl transition-all duration-200",
                      form.category === cat.value
                        ? "bg-primary text-primary-foreground shadow-lg shadow-primary/25 scale-105"
                        : "text-muted-foreground bg-card border border-border/50 hover:border-primary/30 hover:text-foreground"
                    )}
                  >
                    <cat.icon className="size-3.5" />
                    {cat.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">难度</Label>
              <select value={form.difficulty} onChange={e => update("difficulty", e.target.value)}
                className="px-3.5 py-2 text-sm rounded-xl border border-border/50 bg-muted/50 text-foreground focus:outline-none focus:ring-2 focus:ring-ring cursor-pointer transition-all h-10 w-full max-w-[200px]">
                {DIFFICULTIES.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
              </select>
            </div>

            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">关联课程</Label>
              <select value={form.course_id} onChange={e => update("course_id", e.target.value)}
                className="px-3.5 py-2 text-sm rounded-xl border border-border/50 bg-muted/50 text-foreground focus:outline-none focus:ring-2 focus:ring-ring cursor-pointer transition-all h-10 w-full max-w-[300px]">
                <option value="">不关联课程</option>
                {courses.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>

            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">实验描述</Label>
              <RichTextEditor
                value={form.description}
                onChange={(html) => update("description", html)}
                placeholder="Enter experiment description..."
                minHeight="150px"
              />
            </div>
          </div>

          {/* Content Card */}
          <div className="rounded-xl border border-border/50 bg-card p-6 space-y-5">
            <h2 className="text-[15px] font-semibold">实验内容</h2>

            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">实验说明 (instructions)</Label>
              <RichTextEditor
                value={form.instructions}
                onChange={(html) => update("instructions", html)}
                placeholder="Enter experiment instructions..."
                minHeight="200px"
              />
            </div>

            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">起始代码 (starter_code)</Label>
              <Textarea
                placeholder="给学生提供的初始代码模板..."
                value={form.starter_code}
                onChange={e => update("starter_code", e.target.value)}
                className="min-h-[200px] rounded-xl bg-muted/50 border-border/50 resize-y font-mono text-sm"
              />
            </div>

            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">参考解答 (reference_solution)</Label>
              <Textarea
                placeholder="参考解答代码（仅教师可见）..."
                value={form.reference_solution}
                onChange={e => update("reference_solution", e.target.value)}
                className="min-h-[200px] rounded-xl bg-muted/50 border-border/50 resize-y font-mono text-sm"
              />
            </div>

            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">答案解析 (answer_explanation)</Label>
              <Textarea
                placeholder="对答案的解析说明..."
                value={form.answer_explanation}
                onChange={e => update("answer_explanation", e.target.value)}
                className="min-h-[100px] rounded-xl bg-muted/50 border-border/50 resize-y"
              />
            </div>
          </div>
        </div>

        {/* Right Column - Settings */}
        <div className="space-y-6">
          <div className="rounded-xl border border-border/50 bg-card p-6 space-y-5">
            <h2 className="text-[15px] font-semibold">高级设置</h2>

            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">时间限制 (秒)</Label>
              <Input
                type="number" min={1} max={3600}
                value={form.time_limit}
                onChange={e => update("time_limit", parseInt(e.target.value) || 300)}
                className="h-10 rounded-xl bg-muted/50 border-border/50"
              />
            </div>

            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">内存限制 (字节)</Label>
              <Input
                type="number" min={1}
                value={form.memory_limit}
                onChange={e => update("memory_limit", parseInt(e.target.value) || 268435456)}
                className="h-10 rounded-xl bg-muted/50 border-border/50"
              />
              <span className="text-[11px] text-muted-foreground mt-1 block">默认 256MB = 268435456</span>
            </div>

            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">沙箱等级 (1-3)</Label>
              <select value={form.sandbox_level} onChange={e => update("sandbox_level", parseInt(e.target.value))}
                className="px-3.5 py-2 text-sm rounded-xl border border-border/50 bg-muted/50 text-foreground focus:outline-none focus:ring-2 focus:ring-ring cursor-pointer transition-all h-10 w-full">
                <option value={1}>Level 1 - 基础隔离</option>
                <option value={2}>Level 2 - 中度隔离</option>
                <option value={3}>Level 3 - 严格隔离</option>
              </select>
            </div>

            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">最大提交次数</Label>
              <Input
                type="number" min={1} max={999}
                value={form.max_submissions}
                onChange={e => update("max_submissions", parseInt(e.target.value) || 100)}
                className="h-10 rounded-xl bg-muted/50 border-border/50"
              />
            </div>

            <div className="flex items-center justify-between pt-2">
              <Label className="text-sm">立即发布</Label>
              <Switch
                checked={form.is_published}
                onCheckedChange={v => update("is_published", v)}
              />
            </div>
          </div>

          <Button onClick={handleSave} disabled={saving} className="w-full rounded-xl gap-2 h-11 shadow-lg shadow-primary/20">
            <Save className="size-4" /> {saving ? "保存中..." : "创建实验"}
          </Button>
        </div>
      </div>
    </div>
  );
}
