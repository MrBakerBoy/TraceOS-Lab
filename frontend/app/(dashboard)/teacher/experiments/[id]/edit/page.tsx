"use client";

import { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import RichTextEditor from "@/components/ui/RichTextEditor";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { showToast } from "@/components/ui/Toast";
import { cn } from "@/lib/utils";
import {
  FlaskConical, ArrowLeft, Save, Sparkles, Cpu, Zap, Brain,
  HardDrive, Timer, Lock, Plus, Edit, Trash2, TestTube, RefreshCw, ChevronDown, ChevronRight
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

const TC_TYPES = ["normal", "edge_case", "performance", "security"];
const COMPARE_MODES = ["normalized_contains", "exact", "regex"];

interface TestCase {
  id: string;
  experiment_id: string;
  name: string;
  type: string;
  compare_mode: string;
  input_data: string;
  expected_output: string;
  is_public: boolean;
  score_weight: number;
  order_index: number;
}

export default function EditExperimentPage() {
  const router = useRouter();
  const params = useParams();
  const id = params.id as string;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<"info" | "testcases">("info");
  const [testCases, setTestCases] = useState<TestCase[]>([]);
  const [tcDialogOpen, setTcDialogOpen] = useState(false);
  const [editingTc, setEditingTc] = useState<TestCase | null>(null);
  const [tcDeleteTarget, setTcDeleteTarget] = useState<TestCase | null>(null);
  const [expandedTc, setExpandedTc] = useState<string | null>(null);

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

  const [tcForm, setTcForm] = useState({
    name: "",
    type: "normal",
    compare_mode: "normalized_contains",
    input_data: "",
    expected_output: "",
    is_public: true,
    score_weight: 10,
    order_index: 0,
  });

  useEffect(() => {
    loadExperiment();
  }, [id]);

  const loadExperiment = async () => {
    setLoading(true);
    try {
      const res = await api.getExperiment(id);
      const exp = res.experiment;
      setForm({
        name: exp.name || "",
        title: exp.title || "",
        category: exp.category || "process",
        difficulty: exp.difficulty || "medium",
        description: exp.description || "",
        instructions: exp.instructions || "",
        starter_code: exp.starter_code || "",
        reference_solution: exp.reference_solution || "",
        answer_explanation: (exp as any).answer_explanation || "",
        course_id: exp.course_id || "",
        time_limit: exp.time_limit || 300,
        memory_limit: exp.memory_limit || 268435456,
        sandbox_level: exp.sandbox_level || 1,
        max_submissions: exp.max_submissions || 100,
        is_published: exp.is_published || false,
      });
      setTestCases(res.test_cases || []);
    } catch (err: any) {
      showToast("error", "加载实验失败");
    } finally {
      setLoading(false);
    }
  };

  const update = (key: string, value: any) => setForm(prev => ({ ...prev, [key]: value }));
  const updateTc = (key: string, value: any) => setTcForm(prev => ({ ...prev, [key]: value }));

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
        description: form.description.trim() || null,
        instructions: form.instructions.trim() || null,
        starter_code: form.starter_code.trim() || null,
        reference_solution: form.reference_solution.trim() || null,
        answer_explanation: form.answer_explanation.trim() || null,
      };
      if (form.course_id) payload.course_id = form.course_id;

      await api.updateExperiment(id, payload);
      showToast("success", "实验已更新");
    } catch (err: any) {
      showToast("error", err?.message || "更新失败");
    } finally {
      setSaving(false);
    }
  };

  // Test Case handlers
  const openCreateTc = () => {
    setEditingTc(null);
    setTcForm({
      name: "",
      type: "normal",
      compare_mode: "normalized_contains",
      input_data: "",
      expected_output: "",
      is_public: true,
      score_weight: 10,
      order_index: testCases.length,
    });
    setTcDialogOpen(true);
  };

  const openEditTc = (tc: TestCase) => {
    setEditingTc(tc);
    setTcForm({
      name: tc.name,
      type: tc.type,
      compare_mode: tc.compare_mode,
      input_data: tc.input_data || "",
      expected_output: tc.expected_output || "",
      is_public: tc.is_public,
      score_weight: tc.score_weight,
      order_index: tc.order_index,
    });
    setTcDialogOpen(true);
  };

  const handleTcSave = async () => {
    if (!tcForm.name.trim()) {
      showToast("error", "测试用例名称不能为空");
      return;
    }
    try {
      if (editingTc) {
        await api.updateTestCase(editingTc.id, {
          name: tcForm.name.trim(),
          type: tcForm.type,
          compare_mode: tcForm.compare_mode,
          input_data: tcForm.input_data,
          expected_output: tcForm.expected_output,
          is_public: tcForm.is_public,
          score_weight: tcForm.score_weight,
          order_index: tcForm.order_index,
        });
        showToast("success", "测试用例已更新");
      } else {
        await api.createTestCase({
          experiment_id: id,
          name: tcForm.name.trim(),
          type: tcForm.type,
          compare_mode: tcForm.compare_mode,
          input_data: tcForm.input_data,
          expected_output: tcForm.expected_output,
          is_public: tcForm.is_public,
          score_weight: tcForm.score_weight,
          order_index: tcForm.order_index,
        });
        showToast("success", "测试用例已创建");
      }
      setTcDialogOpen(false);
      loadExperiment(); // Reload to get updated test cases
    } catch (err: any) {
      showToast("error", err?.message || "操作失败");
    }
  };

  const handleTcDelete = async () => {
    if (!tcDeleteTarget) return;
    try {
      await api.deleteTestCase(tcDeleteTarget.id);
      showToast("success", "测试用例已删除");
      setTcDeleteTarget(null);
      loadExperiment();
    } catch (err: any) {
      showToast("error", err?.message || "删除失败");
    }
  };

  const catInfo = CATEGORIES.find(c => c.value === form.category) || CATEGORIES[0];
  const CatIcon = catInfo.icon;

  if (loading) {
    return (
      <div className="p-8 max-w-5xl mx-auto">
        <Skeleton className="h-10 w-64 mb-6 rounded-xl" />
        <Skeleton className="h-[400px] w-full rounded-xl" />
      </div>
    );
  }

  return (
    <div className="p-8 animate-fade-in max-w-5xl mx-auto">
      <div className="absolute top-0 left-0 right-0 h-[2px] kernel-scan opacity-40" />

      {/* Header */}
      <div className="flex items-center justify-between mb-8 flex-wrap gap-4">
        <div className="flex items-center gap-3">
          <button onClick={() => router.push("/teacher/experiments")} className="p-2 rounded-xl hover:bg-muted transition-colors">
            <ArrowLeft className="size-5 text-muted-foreground" />
          </button>
          <div className="relative">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#FF9F0A] via-[#FF453A] to-[#BF5AF2] flex items-center justify-center shadow-lg shadow-orange-500/25">
              <Edit className="size-5 text-white" strokeWidth={1.8} />
            </div>
          </div>
          <div>
            <h1 className="text-[28px] font-bold tracking-[-0.02em]">编辑实验</h1>
            <p className="text-sm text-muted-foreground">{form.title || form.name}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" onClick={() => router.push("/teacher/experiments")} className="rounded-xl h-11">
            返回列表
          </Button>
          <Button onClick={handleSave} disabled={saving} className="rounded-xl gap-2 h-11 shadow-lg shadow-primary/20">
            <Save className="size-4" /> {saving ? "保存中..." : "保存修改"}
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-border/50 pb-0">
        <button
          onClick={() => setActiveTab("info")}
          className={cn(
            "px-5 py-2.5 text-sm font-medium rounded-t-xl transition-all border-b-2 -mb-[1px]",
            activeTab === "info"
              ? "border-primary text-foreground bg-card"
              : "border-transparent text-muted-foreground hover:text-foreground"
          )}
        >
          <Edit className="size-4 inline mr-1.5" />
          基本信息 & 设置
        </button>
        <button
          onClick={() => setActiveTab("testcases")}
          className={cn(
            "px-5 py-2.5 text-sm font-medium rounded-t-xl transition-all border-b-2 -mb-[1px]",
            activeTab === "testcases"
              ? "border-primary text-foreground bg-card"
              : "border-transparent text-muted-foreground hover:text-foreground"
          )}
        >
          <TestTube className="size-4 inline mr-1.5" />
          测试用例管理 ({testCases.length})
        </button>
      </div>

      {activeTab === "info" ? (
        /* Info Tab */
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
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
                  <Input value={form.name} onChange={e => update("name", e.target.value)}
                    className="h-10 rounded-xl bg-muted/50 border-border/50" />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground mb-1.5 block">实验标题</Label>
                  <Input value={form.title} onChange={e => update("title", e.target.value)}
                    className="h-10 rounded-xl bg-muted/50 border-border/50" />
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
                      <cat.icon className="size-3.5" />{cat.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label className="text-xs text-muted-foreground mb-1.5 block">难度</Label>
                  <select value={form.difficulty} onChange={e => update("difficulty", e.target.value)}
                    className="px-3.5 py-2 text-sm rounded-xl border border-border/50 bg-muted/50 text-foreground focus:outline-none focus:ring-2 focus:ring-ring cursor-pointer transition-all h-10 w-full">
                    {DIFFICULTIES.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
                  </select>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground mb-1.5 block">关联课程 ID</Label>
                  <Input value={form.course_id} onChange={e => update("course_id", e.target.value)}
                    className="h-10 rounded-xl bg-muted/50 border-border/50" placeholder="留空表示不关联" />
                </div>
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
                <Textarea value={form.starter_code} onChange={e => update("starter_code", e.target.value)}
                  className="min-h-[200px] rounded-xl bg-muted/50 border-border/50 resize-y font-mono text-sm" />
              </div>

              <div>
                <Label className="text-xs text-muted-foreground mb-1.5 block">参考解答 (reference_solution)</Label>
                <Textarea value={form.reference_solution} onChange={e => update("reference_solution", e.target.value)}
                  className="min-h-[200px] rounded-xl bg-muted/50 border-border/50 resize-y font-mono text-sm" />
              </div>

              <div>
                <Label className="text-xs text-muted-foreground mb-1.5 block">答案解析 (answer_explanation)</Label>
                <Textarea value={form.answer_explanation} onChange={e => update("answer_explanation", e.target.value)}
                  className="min-h-[100px] rounded-xl bg-muted/50 border-border/50 resize-y" />
              </div>
            </div>
          </div>

          <div className="space-y-6">
            <div className="rounded-xl border border-border/50 bg-card p-6 space-y-5">
              <h2 className="text-[15px] font-semibold">高级设置</h2>

              <div>
                <Label className="text-xs text-muted-foreground mb-1.5 block">时间限制 (秒)</Label>
                <Input type="number" min={1} max={3600} value={form.time_limit}
                  onChange={e => update("time_limit", parseInt(e.target.value) || 300)}
                  className="h-10 rounded-xl bg-muted/50 border-border/50" />
              </div>

              <div>
                <Label className="text-xs text-muted-foreground mb-1.5 block">内存限制 (字节)</Label>
                <Input type="number" min={1} value={form.memory_limit}
                  onChange={e => update("memory_limit", parseInt(e.target.value) || 268435456)}
                  className="h-10 rounded-xl bg-muted/50 border-border/50" />
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
                <Input type="number" min={1} max={999} value={form.max_submissions}
                  onChange={e => update("max_submissions", parseInt(e.target.value) || 100)}
                  className="h-10 rounded-xl bg-muted/50 border-border/50" />
              </div>

              <div className="flex items-center justify-between pt-2">
                <Label className="text-sm">已发布</Label>
                <Switch checked={form.is_published} onCheckedChange={v => update("is_published", v)} />
              </div>
            </div>

            <Button onClick={handleSave} disabled={saving} className="w-full rounded-xl gap-2 h-11 shadow-lg shadow-primary/20">
              <Save className="size-4" /> {saving ? "保存中..." : "保存修改"}
            </Button>
          </div>
        </div>
      ) : (
        /* Test Cases Tab */
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">管理此实验的测试用例，用于自动评测学生提交的代码。</p>
            <Button onClick={openCreateTc} className="rounded-xl gap-2 h-10 shadow-lg shadow-primary/20">
              <Plus className="size-4" /> 新增测试用例
            </Button>
          </div>

          {testCases.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-3 rounded-xl border border-border/50 bg-card">
              <TestTube className="size-12 opacity-20" />
              <span className="text-sm">暂无测试用例</span>
              <Button variant="outline" onClick={openCreateTc} className="rounded-xl gap-2 mt-2">
                <Plus className="size-4" /> 添加第一个测试用例
              </Button>
            </div>
          ) : (
            <div className="rounded-xl border border-border/50 bg-card overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/50 bg-muted/30">
                    <th className="text-left px-2.5 py-2.5 text-xs font-medium text-muted-foreground w-8"></th>
                    <th className="text-left px-2.5 py-2.5 text-xs font-medium text-muted-foreground">#</th>
                    <th className="text-left px-2.5 py-2.5 text-xs font-medium text-muted-foreground">名称</th>
                    <th className="text-left px-2.5 py-2.5 text-xs font-medium text-muted-foreground">类型</th>
                    <th className="text-left px-2.5 py-2.5 text-xs font-medium text-muted-foreground">比较模式</th>
                    <th className="text-left px-2.5 py-2.5 text-xs font-medium text-muted-foreground">权重</th>
                    <th className="text-left px-2.5 py-2.5 text-xs font-medium text-muted-foreground">公开</th>
                    <th className="text-right px-2.5 py-2.5 text-xs font-medium text-muted-foreground">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {testCases.map((tc, idx) => {
                    const isExpanded = expandedTc === tc.id;
                    return [
                      <tr key={tc.id} className="border-b border-border/30 last:border-0 hover:bg-muted/20 transition-colors cursor-pointer"
                        onClick={() => setExpandedTc(isExpanded ? null : tc.id)}>
                        <td className="px-2.5 py-2.5 text-muted-foreground">
                          {isExpanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
                        </td>
                        <td className="px-2.5 py-2.5 text-muted-foreground text-xs">{tc.order_index ?? idx}</td>
                        <td className="px-2.5 py-2.5 font-medium text-sm">{tc.name}</td>
                        <td className="px-2.5 py-2.5">
                          <Badge variant="outline" className="text-[11px]">{tc.type}</Badge>
                        </td>
                        <td className="px-2.5 py-2.5">
                          <span className={cn(
                            "text-[11px] px-1.5 py-0.5 rounded font-mono",
                            tc.compare_mode === "regex" && "bg-purple-500/10 text-purple-400",
                            tc.compare_mode === "exact" && "bg-blue-500/10 text-blue-400",
                            tc.compare_mode === "normalized_contains" && "bg-teal-500/10 text-teal-400"
                          )}>{tc.compare_mode}</span>
                        </td>
                        <td className="px-2.5 py-2.5 text-muted-foreground text-xs">{tc.score_weight}</td>
                        <td className="px-2.5 py-2.5">
                          {tc.is_public ? (
                            <span className="text-green-400 text-xs">公开</span>
                          ) : (
                            <span className="text-orange-400 text-xs">隐藏</span>
                          )}
                        </td>
                        <td className="px-2.5 py-2.5 text-right" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center justify-end gap-1">
                            <Button variant="ghost" size="icon" className="size-7 rounded-lg"
                              onClick={() => openEditTc(tc)}>
                              <Edit className="size-3.5" />
                            </Button>
                            <Button variant="ghost" size="icon" className="size-7 rounded-lg hover:text-destructive"
                              onClick={() => setTcDeleteTarget(tc)}>
                              <Trash2 className="size-3.5" />
                            </Button>
                          </div>
                        </td>
                      </tr>,
                      isExpanded && (
                        <tr key={`${tc.id}-detail`} className="border-b border-border/30 bg-muted/10">
                          <td colSpan={8} className="px-6 py-4">
                            <div className="grid grid-cols-2 gap-4">
                              <div>
                                <div className="flex items-center gap-2 mb-2">
                                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">输入数据</span>
                                  {tc.input_data ? (
                                    <span className="text-[10px] text-muted-foreground">{tc.input_data.length} 字符</span>
                                  ) : null}
                                </div>
                                <pre className="text-xs font-mono bg-black/30 border border-border/30 rounded-lg p-3 overflow-x-auto max-h-64 overflow-y-auto whitespace-pre-wrap break-all text-foreground/80">
                                  {tc.input_data || <span className="text-muted-foreground italic">（空）</span>}
                                </pre>
                              </div>
                              <div>
                                <div className="flex items-center gap-2 mb-2">
                                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">期望输出</span>
                                  {tc.expected_output ? (
                                    <span className="text-[10px] text-muted-foreground">{tc.expected_output.length} 字符</span>
                                  ) : null}
                                </div>
                                <pre className="text-xs font-mono bg-black/30 border border-border/30 rounded-lg p-3 overflow-x-auto max-h-64 overflow-y-auto whitespace-pre-wrap break-all text-foreground/80">
                                  {tc.expected_output || <span className="text-muted-foreground italic">（空）</span>}
                                </pre>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )
                    ].filter(Boolean);
                  })}
                </tbody>
              </table>
            </div>
          )}
          
          <div className="flex justify-end">
            <Button variant="outline" onClick={loadExperiment} className="rounded-xl gap-2">
              <RefreshCw className="size-4" /> 刷新列表
            </Button>
          </div>
        </div>
      )}

      {/* Test Case Create/Edit Dialog */}
      <Dialog open={tcDialogOpen} onOpenChange={(open) => { if (!open) setTcDialogOpen(false); }}>
        <DialogPortal>
          <DialogOverlay className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50" />
          <DialogContent className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-2xl bg-card border border-border rounded-2xl shadow-2xl p-6 max-h-[90vh] overflow-y-auto">
            <DialogTitle className="text-lg font-semibold mb-1">
              {editingTc ? "编辑测试用例" : "新增测试用例"}
            </DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground mb-5">
              填写测试用例的详细信息
            </DialogDescription>

            <div className="space-y-4">
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5 block">名称</Label>
                <Input value={tcForm.name} onChange={e => updateTc("name", e.target.value)}
                  placeholder="例如: 基本功能测试" className="h-10 rounded-xl bg-muted/50 border-border/50" />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs text-muted-foreground mb-1.5 block">类型</Label>
                  <select value={tcForm.type} onChange={e => updateTc("type", e.target.value)}
                    className="px-3 py-2 text-sm rounded-xl border border-border/50 bg-muted/50 text-foreground focus:outline-none focus:ring-2 focus:ring-ring cursor-pointer transition-all h-10 w-full">
                    {TC_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground mb-1.5 block">比较模式</Label>
                  <select value={tcForm.compare_mode} onChange={e => updateTc("compare_mode", e.target.value)}
                    className="px-3 py-2 text-sm rounded-xl border border-border/50 bg-muted/50 text-foreground focus:outline-none focus:ring-2 focus:ring-ring cursor-pointer transition-all h-10 w-full">
                    {COMPARE_MODES.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <Label className="text-xs text-muted-foreground">输入数据</Label>
                  <span className="text-[10px] text-muted-foreground font-mono tabular-nums">{tcForm.input_data.length} 字符</span>
                </div>
                <Textarea value={tcForm.input_data} onChange={e => updateTc("input_data", e.target.value)}
                  placeholder="测试的输入数据..." className="min-h-[200px] rounded-xl bg-black/30 border border-border/50 resize-y font-mono text-sm leading-relaxed focus:border-primary/50 focus:ring-1 focus:ring-primary/30 placeholder:text-muted-foreground/40" />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <Label className="text-xs text-muted-foreground">期望输出</Label>
                  <span className="text-[10px] text-muted-foreground font-mono tabular-nums">{tcForm.expected_output.length} 字符</span>
                </div>
                <Textarea value={tcForm.expected_output} onChange={e => updateTc("expected_output", e.target.value)}
                  placeholder="期望的输出结果..." className="min-h-[200px] rounded-xl bg-black/30 border border-border/50 resize-y font-mono text-sm leading-relaxed focus:border-primary/50 focus:ring-1 focus:ring-primary/30 placeholder:text-muted-foreground/40" />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <Label className="text-xs text-muted-foreground mb-1.5 block">分数权重</Label>
                  <Input type="number" min={1} max={100} value={tcForm.score_weight}
                    onChange={e => updateTc("score_weight", parseInt(e.target.value) || 10)}
                    className="h-10 rounded-xl bg-muted/50 border-border/50" />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground mb-1.5 block">排序</Label>
                  <Input type="number" min={0} value={tcForm.order_index}
                    onChange={e => updateTc("order_index", parseInt(e.target.value) || 0)}
                    className="h-10 rounded-xl bg-muted/50 border-border/50" />
                </div>
                <div className="flex items-end pb-2">
                  <div className="flex items-center gap-2">
                    <Switch checked={tcForm.is_public} onCheckedChange={v => updateTc("is_public", v)} />
                    <Label className="text-xs">公开</Label>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-3 mt-6">
              <Button variant="outline" onClick={() => setTcDialogOpen(false)} className="rounded-xl">取消</Button>
              <Button onClick={handleTcSave} className="rounded-xl shadow-lg shadow-primary/20">
                {editingTc ? "保存修改" : "创建"}
              </Button>
            </div>
          </DialogContent>
        </DialogPortal>
      </Dialog>

      {/* Test Case Delete Confirmation */}
      <Dialog open={!!tcDeleteTarget} onOpenChange={(open) => { if (!open) setTcDeleteTarget(null); }}>
        <DialogPortal>
          <DialogOverlay className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50" />
          <DialogContent className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-md bg-card border border-border rounded-2xl shadow-2xl p-6">
            <DialogTitle className="text-lg font-semibold mb-2">删除测试用例</DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground mb-6">
              确定要删除测试用例 "{tcDeleteTarget?.name}" 吗？此操作不可撤销。
            </DialogDescription>
            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={() => setTcDeleteTarget(null)} className="rounded-xl">取消</Button>
              <Button onClick={handleTcDelete} className="rounded-xl bg-destructive hover:bg-destructive/90">确认删除</Button>
            </div>
          </DialogContent>
        </DialogPortal>
      </Dialog>
    </div>
  );
}
