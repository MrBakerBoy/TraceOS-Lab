/**
 * Knowledge base shared constants — single source of truth for enums,
 * Chinese labels, and semantic colors used across upload / review / RAG pages.
 */

export const DEFAULT_COURSE_ID = "0a7fd32b-cd5c-46f1-b341-fd0782d42e3b";

export function getActiveCourseId(): string {
  if (typeof window === "undefined") return DEFAULT_COURSE_ID;
  const stored = localStorage.getItem("active_course_id") || DEFAULT_COURSE_ID;
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidPattern.test(stored) ? stored : DEFAULT_COURSE_ID;
}

export interface KnowledgeTypeMeta {
  label: string;
  color: string;
  description: string;
}

export const KNOWLEDGE_TYPES = {
  course_notes: {
    label: "课程讲义",
    color: "#0071e3",
    description: "操作系统课程笔记、讲义与复习资料",
  },
  experiment_docs: {
    label: "实验文档",
    color: "#14b8a6",
    description: "实验指导书、题目与实验报告模板",
  },
  kernel_papers: {
    label: "内核论文",
    color: "#8b5cf6",
    description: "内核、并发、虚拟化相关论文与研读材料",
  },
  error_cases: {
    label: "错误案例库",
    color: "#ff9f0a",
    description: "常见错误、死锁与 bug 案例",
  },
  contest_materials: {
    label: "赛题材料",
    color: "#ef4444",
    description: "竞赛题目与训练材料",
  },
} as const;

export type KnowledgeTypeKey = keyof typeof KNOWLEDGE_TYPES;

export const KNOWLEDGE_TYPE_KEYS = Object.keys(KNOWLEDGE_TYPES) as KnowledgeTypeKey[];

export const CHUNKING_TEMPLATES = {
  general: { label: "通用讲义", description: "按段落 + 句子边界切分，适合大多数文本" },
  kernel_paper: { label: "内核论文", description: "保留摘要/正文结构，段落对齐切分" },
  os_doc: { label: "OS 文档", description: "面向操作系统文档的语义切分" },
  code: { label: "代码", description: "按代码行切分，保留函数/语句块完整性" },
} as const;

export type ChunkingTemplateKey = keyof typeof CHUNKING_TEMPLATES;

export const CHUNKING_TEMPLATE_KEYS = Object.keys(CHUNKING_TEMPLATES) as ChunkingTemplateKey[];

export const TAG_SUGGESTIONS = [
  "死锁",
  "进程管理",
  "线程",
  "同步互斥",
  "内存管理",
  "虚拟内存",
  "文件系统",
  "调度",
  "中断",
  "信号量",
  "互斥锁",
  "eBPF",
  "xv6",
  "pintos",
  "系统调用",
];

export interface StatusMeta {
  label: string;
  color: string;
  /** tailwind-safe semantic token used for the badge background */
  tone: "neutral" | "success" | "warning" | "error" | "info";
}

export const ENTRY_STATUS: Record<string, StatusMeta> = {
  pending_review: { label: "待审核", color: "#ff9f0a", tone: "warning" },
  approved: { label: "已通过", color: "#30d158", tone: "success" },
  rejected: { label: "已驳回", color: "#ff453a", tone: "error" },
  unpublished: { label: "已下架", color: "#8d8d97", tone: "neutral" },
};

export function knowledgeTypeMeta(type: string | null | undefined): KnowledgeTypeMeta {
  const key = (type ?? "course_notes") as KnowledgeTypeKey;
  return KNOWLEDGE_TYPES[key] ?? KNOWLEDGE_TYPES.course_notes;
}

export function statusMeta(status: string | null | undefined): StatusMeta {
  return ENTRY_STATUS[status ?? ""] ?? { label: status || "未知", color: "#8d8d97", tone: "neutral" };
}

/** Map a [0,1] similarity to a semantic tone for the progress bar. */
export function similarityTone(similarity: number): "success" | "warning" | "error" {
  if (similarity >= 0.8) return "success";
  if (similarity >= 0.6) return "warning";
  return "error";
}

export const SUPPORTED_EXTENSIONS = [".pdf", ".md", ".txt", ".docx", ".c", ".h", ".py", ".cpp", ".hpp", ".go", ".rs", ".js", ".ts"];
export const MAX_FILE_SIZE_MB = 50;