"""
CodePolish Skill — AI 回复中代码片段的视觉润色引擎。

提供:
  - 5 种主题配色方案 (Ocean / Forest / Sunset / Lavender / Midnight)
  - 每种主题在 light/dark 下保证 WCAG AA 对比度
  - 代码片段格式化规范 + 视觉增强指令 (badge/icon/flow)
  - 自然融入系统 prompt 的上下文注入

设计原则:
  - 不是模板，是「视觉调色盘」— AI 根据上下文自行搭配
  - 配色经过对比度校验 (light 背景 ≥ 4.5:1, dark 背景 ≥ 4.5:1)
  - 禁止硬编码颜色值到回复中，改用 Markdown 原生能力
"""

from enum import Enum
from dataclasses import dataclass
from typing import Optional


# ============================================================================
# 5 种主题定义
# ============================================================================

class ThemeVariant(Enum):
    OCEAN = "ocean"       # 蓝青色 — 默认，适合通用教学
    FOREST = "forest"     # 翠绿色 — 适合内存/资源管理
    SUNSET = "sunset"     # 暖橙色 — 适合并发/调度/死锁
    LAVENDER = "lavender" # 紫色 — 适合文件系统/IO
    MIDNIGHT = "midnight" # 深靛蓝 — 适合内核/底层


@dataclass
class ThemeColors:
    """主题配色定义。

    hex: 不受 light/dark 影响的固定色值 (用于 SVG/Mermaid)
    light_bg / light_fg: light mode 下的背景色和前景色
    dark_bg / dark_fg: dark mode 下的背景色和前景色
    accent: 强调色 (badge/highlight)
    border: 边框色
    """
    name: str
    hex: str
    light_bg: str
    light_fg: str
    dark_bg: str
    dark_fg: str
    accent: str
    border: str
    gradient: str
    use_case: str


THEMES: dict[ThemeVariant, ThemeColors] = {
    ThemeVariant.OCEAN: ThemeColors(
        name="海洋蓝",
        hex="#0891B2",
        light_bg="#ECFEFF",   light_fg="#164E63",
        dark_bg="#0F2B33",    dark_fg="#A5F3FC",
        accent="#06B6D4",
        border="#22D3EE",
        gradient="cyan-to-blue",
        use_case="通用教学 · 进程管理 · 基础知识",
    ),
    ThemeVariant.FOREST: ThemeColors(
        name="森林绿",
        hex="#059669",
        light_bg="#ECFDF5",   light_fg="#14532D",
        dark_bg="#0F3322",    dark_fg="#A7F3D0",
        accent="#10B981",
        border="#34D399",
        gradient="emerald-to-green",
        use_case="内存管理 · 资源回收 · valgrind 分析",
    ),
    ThemeVariant.SUNSET: ThemeColors(
        name="日落橙",
        hex="#EA580C",
        light_bg="#FFF7ED",   light_fg="#7C2D12",
        dark_bg="#332411",    dark_fg="#FED7AA",
        accent="#F97316",
        border="#FB923C",
        gradient="orange-to-amber",
        use_case="并发编程 · 死锁检测 · 调度分析",
    ),
    ThemeVariant.LAVENDER: ThemeColors(
        name="薰衣草紫",
        hex="#7C3AED",
        light_bg="#F5F3FF",   light_fg="#3B0764",
        dark_bg="#1E1033",    dark_fg="#DDD6FE",
        accent="#8B5CF6",
        border="#A78BFA",
        gradient="violet-to-purple",
        use_case="文件系统 · I/O 重定向 · FD 管理",
    ),
    ThemeVariant.MIDNIGHT: ThemeColors(
        name="午夜靛",
        hex="#4F46E5",
        light_bg="#EEF2FF",   light_fg="#1E1B4B",
        dark_bg="#111133",    dark_fg="#C7D2FE",
        accent="#6366F1",
        border="#818CF8",
        gradient="indigo-to-blue",
        use_case="内核机制 · 系统调用 · eBPF 追踪",
    ),
}


# ============================================================================
# 主题 → 实验类别自动映射
# ============================================================================

CATEGORY_THEME_MAP: dict[str, ThemeVariant] = {
    "process":   ThemeVariant.OCEAN,
    "thread":    ThemeVariant.SUNSET,
    "memory":    ThemeVariant.FOREST,
    "fs":        ThemeVariant.LAVENDER,
    "scheduler": ThemeVariant.SUNSET,
    "deadlock":  ThemeVariant.SUNSET,
    "kernel":    ThemeVariant.MIDNIGHT,
    "ipc":       ThemeVariant.OCEAN,
    "signal":    ThemeVariant.OCEAN,
    "default":   ThemeVariant.OCEAN,
}


def get_theme_for_category(category: str) -> ThemeVariant:
    """根据实验类别返回推荐主题。"""
    return CATEGORY_THEME_MAP.get(category.lower(), ThemeVariant.OCEAN)


# ============================================================================
# Code Polish Skill — 注入到 AI 系统 prompt 的上下文指令
# ============================================================================

CODE_POLISH_SKILL_PROMPT = """## 视觉表达工具箱

你的回复要像一本设计精良的教科书——内容扎实，视觉上也让人愿意读下去。
不要每次都千篇一律的纯文字段落。灵活选用下面的视觉元素，让每次回复有不同的节奏感。

### 可用视觉元素 (每次选 2-3 种组合，要有变化):

1. **Mermaid 图表**: 用流程图或时序图解释概念关系
   - 适合: 解释 fork/exec 流程、锁竞争、调度顺序
   - 格式: ```mermaid\ngraph TD\n  A[父进程] -->|fork| B[子进程]\n  ...\n```

2. **对比表格**: 用表格对比容易混淆的概念
   - 适合: fork vs clone, mutex vs semaphore, pipe vs FIFO
   - 格式: | 特性 | fork() | clone() |\n| ... | ... | ... |

3. **分层卡片**: 用 blockquote 嵌套表示难度递进
   - 适合: L1→L2→L3 分层提示
   - 格式: > **💡 L1 方向**: ...\n> > **🎯 L2 策略**: ...

4. **ASCII 结构图**: 用 ASCII art 画内存布局或文件结构
   - 适合: 虚拟地址空间、inode 结构、FD 表
   - 格式:
     ```
     ┌─────────────┐
     │  栈 (Stack)  │ ← 局部变量
     ├─────────────┤
     │     ...      │
     └─────────────┘
     ```

5. **emoji 状态标签**: 用 emoji 做快速状态识别
   - ✅ 正确 / ❌ 错误 / ⚠️ 警告 / 🔍 深入 / 💡 提示
   - 每段最多 1-2 个，不要滥用

6. **引用式关键结论**: 用 > 引用重要的「一语道破」结论
   - > 🔑 **关键**: fork() 在子进程中返回 0，这是区分子进程的唯一信号。

7. **编号步骤**: 调试步骤或排查流程用有序列表
   - 适合: "1. 先用 strace 抓系统调用\n2. 分析 FD 配对..."

### 代码片段的展示规范

当你的回复中包含代码时，遵循这些规范让代码好看又好读:

1. **语法高亮**: 始终使用正确的语言标签 \`\`\`c / \`\`\`python / \`\`\`bash
2. **行内代码**: 概念/命令/函数名用 `inline code` 包裹
3. **关键行高亮**: 用注释标记重点行 — `/* 👈 关键：这一行决定了子进程的行为 */`
4. **对比展示**: 错误代码和正确代码并排对比时，用两个代码块
5. **不超过 5 行**: 教学回复中代码演示不超过 5 行，如果必须更长则用 `// ... 省略 ...`
6. **代码前必有说明**: 每个代码块前有一句话说明它的目的

### 回答结构多样性

不同的问题用不同的叙事结构——不要每次都是「背景→分析→总结」:

- **故事式**: "想象你是一家餐厅的老板（OS），服务员们（进程）..."
- **侦探式**: "我们遇到了一个线索... 让我带你一步步破案"
- **对比式**: "看看这段代码和预期行为之间的差距在哪里"
- **问答式**: 先回答核心问题，再展开解释
- **层层递进式**: 从一个简单的例子开始，逐步增加复杂度
- **反模式展示式**: 先展示常见错误，再展示正确做法

### 禁止

- 不要每次都用完全相同的视觉元素组合
- 不要用 emoji 替代实质内容
- 不要用图片/图表替代文字解释——图表是辅助，不是主体
- 代码块不要超过 5 行 (除非是完整的学生代码引用)
"""


# ============================================================================
# Theme-aware 上下文注入
# ============================================================================

def build_theme_context(theme: ThemeVariant) -> str:
    """构建特定主题的上下文注入片段。"""
    colors = THEMES[theme]
    return f"""## 当前视觉主题: {colors.name}

主题配色参考 (你只需要了解，不需要在回复中写出来):
- 强调色: {colors.hex}
- 适用场景: {colors.use_case}

你可以根据这个主题选择对应的视觉风格:
- Mermaid 图使用 {colors.gradient} 配色
- 表格标题行可以用该色系的 Markdown 标记
- emoji 选择呼应主题色调 (如 Ocean 用 🌊🐚🫧, Forest 用 🌲🍃🪵, Sunset 用 🌅🔥⚡, Lavender 用 💜🌸🔮, Midnight 用 🌙✨🌌)
"""


def build_code_polish_context(
    theme: ThemeVariant | None = None,
    category: str = "",
    enable_advanced: bool = True,
) -> str:
    """构建代码润色 Skill 的完整上下文注入。

    Args:
        theme: 指定主题，如果为 None 则根据 category 自动选择
        category: 实验类别 (用于自动选主题)
        enable_advanced: 是否启用高级视觉元素 (Mermaid/ASCII图)

    Returns:
        完整的上下文字符串，可直接拼到 system prompt
    """
    if theme is None:
        theme = get_theme_for_category(category)

    parts = [CODE_POLISH_SKILL_PROMPT]

    if enable_advanced:
        parts.append(build_theme_context(theme))

    return "\n\n".join(parts)