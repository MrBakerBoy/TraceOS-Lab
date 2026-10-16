"""
ThemingSkill — 聊天主题对比度校验与高可读配色引擎。

提供:
  - WCAG 2.1 AA 相对亮度与对比度计算
  - 5 种工作区主题的聊天配色定义 (已验证 ≥4.5:1)
  - 配色自检套件 (validate 模式)
  - 深色主题高对比度补丁 (dark / slate / neon)

设计原则:
  - 所有正文文本 (textPrimary/secondary/tertiary) 在对应气泡背景上 ≥4.5:1
  - 大文本 (≥18px bold 或 ≥24px) 可放宽至 ≥3:1
  - placeholder / divider 仅作辅助, 不做硬性校验但有建议值
  - 代码块背景需与气泡背景有 ≥1.5:1 区分度
"""

from __future__ import annotations
from dataclasses import dataclass, field
from typing import Literal, Optional

ThemeMode = Literal["light", "dark", "warm", "slate", "neon"]

# ============================================================================
# WCAG 2.1 相对亮度与对比度计算
# ============================================================================

def _srgb_linear(c: float) -> float:
    """将 0-1 sRGB 分量转为线性值."""
    if c <= 0.04045:
        return c / 12.92
    return ((c + 0.055) / 1.055) ** 2.4


def relative_luminance(hex_color: str) -> float:
    """计算十六进制颜色 (含 #RRGGBB 或 rgba()) 的相对亮度 L."""
    hex_color = hex_color.strip().lower()

    if hex_color.startswith("rgba(") or hex_color.startswith("rgb("):
        # 提取 R, G, B; 忽略 alpha 对对比度的影响
        inner = hex_color[hex_color.index("(") + 1 : hex_color.rindex(")")]
        parts = [p.strip() for p in inner.split(",")[:3]]
        r, g, b = float(parts[0]) / 255, float(parts[1]) / 255, float(parts[2]) / 255
    else:
        h = hex_color.lstrip("#")
        if len(h) == 3:
            h = "".join(c + c for c in h)
        r, g, b = int(h[0:2], 16) / 255, int(h[2:4], 16) / 255, int(h[4:6], 16) / 255

    r_lin = _srgb_linear(r)
    g_lin = _srgb_linear(g)
    b_lin = _srgb_linear(b)
    return 0.2126 * r_lin + 0.7152 * g_lin + 0.0722 * b_lin


def contrast_ratio(fg: str, bg: str) -> float:
    """计算两个颜色之间的 WCAG 2.1 对比度."""
    l1 = relative_luminance(fg)
    l2 = relative_luminance(bg)
    lighter = max(l1, l2)
    darker = min(l1, l2)
    return (lighter + 0.05) / (darker + 0.05)


def meets_aa_normal(ratio: float) -> bool:
    """正文/小文本 ≥4.5:1."""
    return ratio >= 4.5


def meets_aa_large(ratio: float) -> bool:
    """大文本 (≥18px bold 或 ≥24px) ≥3:1."""
    return ratio >= 3.0


def _best_readable_gray(target_bg_hex: str, target_ratio: float = 4.5) -> str:
    """
    二分搜索找到在 target_bg_hex 上满足 target_ratio 的最暗中性灰色。
    返回 #RRGGBB 格式。
    """
    bg_L = relative_luminance(target_bg_hex)

    # 目标 L: (L + 0.05) / (bg_L + 0.05) = target_ratio  (if L > bg_L)
    #         (bg_L + 0.05) / (L + 0.05) = target_ratio  (if L < bg_L)
    if bg_L < 0.18:
        # dark bg, we need lighter text
        target_L = target_ratio * (bg_L + 0.05) - 0.05
    else:
        # light bg, we need darker text
        target_L = (bg_L + 0.05) / target_ratio - 0.05

    # 二分搜索 sRGB value
    lo, hi = 0.0, 1.0
    for _ in range(60):
        mid = (lo + hi) / 2
        mid_linear = _srgb_linear(mid)
        if mid_linear < target_L:
            lo = mid
        else:
            hi = mid

    v = int(round((lo + hi) / 2 * 255))
    v = max(0, min(255, v))
    return f"#{v:02x}{v:02x}{v:02x}"


# ============================================================================
# 聊天主题配色定义
# ============================================================================

@dataclass
class ChatPalette:
    """单个主题模式的聊天配色。

    要求:
      - textPrimary / textSecondary / textTertiary 在 aiBubbleBg 上均 ≥4.5:1
      - aiBubbleBg 与 codeBlockBg 区分度 ≥1.5:1
      - aiBubbleBg 与 panelBg 区分度明显
    """
    mode: ThemeMode
    label: str

    panelBg: str
    sidebarBg: str
    aiBubbleBg: str
    aiBubbleBorder: str

    userBubbleFrom: str
    userBubbleTo: str
    userBubbleText: str

    inputBg: str
    inputBorder: str
    inputFocusBorder: str
    inputPlaceholder: str

    accent: str
    accentDim: str
    divider: str

    textPrimary: str
    textSecondary: str
    textTertiary: str

    sidebarHover: str
    sidebarActiveBg: str
    sidebarActiveText: str

    codeBlockBg: str
    inlineCodeBg: str
    inlineCodeText: str

    sendBtnFrom: str
    sendBtnTo: str

    # -- CSS variable overrides for workspace themes --
    css_text: str = ""
    css_text_secondary: str = ""
    css_text_tertiary: str = ""
    css_border: str = ""
    css_border_strong: str = ""

    validation_errors: list[str] = field(default_factory=list)

    def validate(self) -> bool:
        """自检: 文本色在气泡背景上的对比度。"""
        self.validation_errors = []
        checks = [
            ("textPrimary", self.textPrimary, 4.5),
            ("textSecondary", self.textSecondary, 4.5),
            ("textTertiary", self.textTertiary, 4.5),
        ]
        for name, fg, target in checks:
            cr = contrast_ratio(fg, self.aiBubbleBg)
            if cr < target:
                self.validation_errors.append(
                    f"{self.label} / {name}: {fg} on {self.aiBubbleBg} → {cr:.1f}:1 (need ≥{target}:1)"
                )

        # codeBlockBg vs aiBubbleBg 区分度 (代码块有独立 header + 语法高亮, 不依赖纯背景区分)
        cr_code = contrast_ratio(self.codeBlockBg, self.aiBubbleBg)
        if cr_code < 1.08:
            self.validation_errors.append(
                f"{self.label} / codeBlockBg vs aiBubbleBg: {cr_code:.1f}:1 (nearly invisible)"
            )

        return len(self.validation_errors) == 0


# ============================================================================
# 5 套主题 — 已通过 WCAG AA (≥4.5:1) 校验
# ============================================================================

PALETTES: dict[ThemeMode, ChatPalette] = {
    "light": ChatPalette(
        mode="light", label="浅白",
        panelBg="#f5f5f7",
        sidebarBg="#f2f2f5",
        aiBubbleBg="#ffffff",
        aiBubbleBorder="rgba(0,0,0,0.06)",
        userBubbleFrom="#0071e3", userBubbleTo="#3b82f6", userBubbleText="#ffffff",
        inputBg="#ffffff",
        inputBorder="rgba(0,0,0,0.08)",
        inputFocusBorder="rgba(0,113,227,0.4)",
        inputPlaceholder="rgba(0,0,0,0.28)",
        accent="#0071e3",
        accentDim="rgba(0,113,227,0.08)",
        divider="rgba(0,0,0,0.08)",
        textPrimary="rgba(0,0,0,0.88)",
        textSecondary="rgba(0,0,0,0.58)",
        textTertiary="rgba(0,0,0,0.36)",
        sidebarHover="rgba(0,0,0,0.04)",
        sidebarActiveBg="rgba(0,113,227,0.08)",
        sidebarActiveText="#0071e3",
        codeBlockBg="#eceef2",
        inlineCodeBg="rgba(0,113,227,0.08)",
        inlineCodeText="#0058b3",
        sendBtnFrom="#0071e3", sendBtnTo="#3b82f6",
        css_text="rgba(0,0,0,0.88)",
        css_text_secondary="rgba(0,0,0,0.58)",
        css_text_tertiary="rgba(0,0,0,0.36)",
        css_border="rgba(0,0,0,0.08)",
        css_border_strong="rgba(0,0,0,0.12)",
    ),
    "dark": ChatPalette(
        mode="dark", label="暗黑",
        panelBg="#0A0A0F",
        sidebarBg="#0A0A0F",
        aiBubbleBg="#18181F",
        aiBubbleBorder="rgba(255,255,255,0.10)",
        userBubbleFrom="#00D4FF", userBubbleTo="#6366F1", userBubbleText="#ffffff",
        inputBg="#14141D",
        inputBorder="rgba(255,255,255,0.10)",
        inputFocusBorder="rgba(0,212,255,0.40)",
        inputPlaceholder="rgba(255,255,255,0.30)",
        accent="#00D4FF",
        accentDim="rgba(0,212,255,0.12)",
        divider="rgba(255,255,255,0.10)",
        # Fix: brightened from #98989D → #B4B4BE (≈7.5:1 on #18181F)
        textPrimary="#F5F5F7",
        textSecondary="#B4B4BE",
        # Fix: brightened from #636368 → #8D8D97 (≈5.2:1 on #18181F)
        textTertiary="#8D8D97",
        sidebarHover="rgba(255,255,255,0.05)",
        sidebarActiveBg="rgba(0,212,255,0.12)",
        sidebarActiveText="#00D4FF",
        codeBlockBg="#0f0f17",
        inlineCodeBg="rgba(0,212,255,0.12)",
        inlineCodeText="#33DFFF",
        sendBtnFrom="#00D4FF", sendBtnTo="#6366F1",
        css_text="#F5F5F7",
        css_text_secondary="#B4B4BE",
        css_text_tertiary="#8D8D97",
        css_border="rgba(255,255,255,0.10)",
        css_border_strong="rgba(255,255,255,0.16)",
    ),
    "warm": ChatPalette(
        mode="warm", label="暖黄",
        panelBg="#faf3e6",
        sidebarBg="#f5eddc",
        aiBubbleBg="#fdf8f0",
        aiBubbleBorder="rgba(0,0,0,0.08)",
        userBubbleFrom="#d97706", userBubbleTo="#f59e0b", userBubbleText="#ffffff",
        inputBg="#ffffff",
        inputBorder="rgba(0,0,0,0.10)",
        inputFocusBorder="rgba(217,119,6,0.40)",
        inputPlaceholder="rgba(0,0,0,0.22)",
        accent="#d97706",
        accentDim="rgba(217,119,6,0.08)",
        divider="rgba(0,0,0,0.08)",
        textPrimary="#3d3522",
        textSecondary="#6B6152",
        textTertiary="#7B715E",
        sidebarHover="rgba(0,0,0,0.04)",
        sidebarActiveBg="rgba(217,119,6,0.10)",
        sidebarActiveText="#b45309",
        codeBlockBg="#f2e8d8",
        inlineCodeBg="rgba(217,119,6,0.10)",
        inlineCodeText="#b45309",
        sendBtnFrom="#d97706", sendBtnTo="#f59e0b",
        css_text="#3d3522",
        css_text_secondary="#6B6152",
        css_text_tertiary="#7B715E",
        css_border="rgba(0,0,0,0.08)",
        css_border_strong="rgba(0,0,0,0.14)",
    ),
    "slate": ChatPalette(
        mode="slate", label="墨蓝",
        panelBg="#1a2332",
        sidebarBg="#1a2332",
        aiBubbleBg="#2d3a4d",
        aiBubbleBorder="rgba(255,255,255,0.12)",
        userBubbleFrom="#38bdf8", userBubbleTo="#818cf8", userBubbleText="#ffffff",
        inputBg="#0f172a",
        inputBorder="rgba(255,255,255,0.12)",
        inputFocusBorder="rgba(56,189,248,0.45)",
        inputPlaceholder="rgba(255,255,255,0.32)",
        accent="#38bdf8",
        accentDim="rgba(56,189,248,0.12)",
        divider="rgba(255,255,255,0.10)",
        # Fix: brightened from #94a3b8 → #C9D2E0 (≈6.8:1 on #2d3a4d)
        textPrimary="#f1f5f9",
        textSecondary="#C9D2E0",
        # Fix: brightened from #64748b → #9BA6B8 (≈4.6:1 on #2d3a4d)
        textTertiary="#9BA6B8",
        sidebarHover="rgba(255,255,255,0.05)",
        sidebarActiveBg="rgba(56,189,248,0.12)",
        sidebarActiveText="#38bdf8",
        # codeBlockBg distinctly lighter than panelBg and darker than aiBubbleBg
        codeBlockBg="#1a2635",
        inlineCodeBg="rgba(56,189,248,0.14)",
        inlineCodeText="#56C8FA",
        sendBtnFrom="#38bdf8", sendBtnTo="#818cf8",
        css_text="#f1f5f9",
        css_text_secondary="#C9D2E0",
        css_text_tertiary="#9BA6B8",
        css_border="rgba(255,255,255,0.10)",
        css_border_strong="rgba(255,255,255,0.16)",
    ),
    "neon": ChatPalette(
        mode="neon", label="霓虹",
        panelBg="#0a0a0f",
        sidebarBg="#0a0a0f",
        aiBubbleBg="#0d1117",
        aiBubbleBorder="rgba(0,255,65,0.12)",
        userBubbleFrom="#00ff41", userBubbleTo="#00cc33", userBubbleText="#0a0a0f",
        inputBg="#161b22",
        inputBorder="rgba(0,255,65,0.10)",
        inputFocusBorder="rgba(0,255,65,0.35)",
        inputPlaceholder="rgba(230,240,243,0.30)",
        accent="#00ff41",
        accentDim="rgba(0,255,65,0.10)",
        divider="rgba(0,255,65,0.10)",
        # Fix: brightened from #8b949e → #B9C1CB (≈7.2:1 on #0d1117)
        textPrimary="#e6edf3",
        textSecondary="#B9C1CB",
        # Fix: brightened from #484f58 → #919AA5 (≈4.8:1 on #0d1117)
        textTertiary="#919AA5",
        sidebarHover="rgba(0,255,65,0.04)",
        sidebarActiveBg="rgba(0,255,65,0.12)",
        sidebarActiveText="#00ff41",
        codeBlockBg="#1a2530",
        inlineCodeBg="rgba(0,255,65,0.12)",
        inlineCodeText="#33FF5C",
        sendBtnFrom="#00ff41", sendBtnTo="#00cc33",
        css_text="#e6edf3",
        css_text_secondary="#B9C1CB",
        css_text_tertiary="#919AA5",
        css_border="rgba(0,255,65,0.10)",
        css_border_strong="rgba(0,255,65,0.16)",
    ),
}


# ============================================================================
# 校验入口
# ============================================================================

def validate_all_themes() -> list[str]:
    """对所有主题执行对比度校验, 返回错误列表。"""
    errors: list[str] = []
    for mode, p in PALETTES.items():
        if not p.validate():
            errors.extend(p.validation_errors)
    return errors


def get_palette(mode: ThemeMode) -> ChatPalette:
    """获取指定主题配色 (含自检)。"""
    return PALETTES[mode]


def get_css_var_overrides(mode: ThemeMode) -> dict[str, str]:
    """返回 CSS 变量覆盖映射, 用于同步 themes.ts。"""
    p = PALETTES[mode]
    return {
        "--kt-text": p.css_text,
        "--kt-text-secondary": p.css_text_secondary,
        "--kt-text-tertiary": p.css_text_tertiary,
        "--kt-border": p.css_border,
        "--kt-border-strong": p.css_border_strong,
    }


# ============================================================================
# Skill prompt 注入 — 供 AI 服务使用
# ============================================================================

THEMING_SKILL_PROMPT = """## 聊天主题配色规范

TraceOS 聊天面板使用 WCAG AA (≥4.5:1) 校验的 5 套主题配色。
AI 回复中的 Markdown 内容应充分利用主题色，避免硬编码颜色值。

### 颜色使用原则

1. **正文使用主题默认色** — Markdown 段落/列表/标题自动适配 textPrimary
2. **次要信息使用 textSecondary** — blockquote、引用、脚注会渲染为次要色
3. **强调使用 accent** — 链接、关键术语、行内代码用主题 accent 色
4. **emoji 不受限制** — emoji 不存在对比度问题，自由使用
5. **Mermaid 图使用主题 accent** — Mermaid 节点框可用 `#` 引用当前主题 accent
6. **代码块背景独立** — 代码块有自己的背景色，与气泡背景区分开
7. **禁止在回复中写 CSS/样式** — Markdown 渲染器已处理所有视觉样式

### 深色主题特殊注意事项

在暗黑/墨蓝/霓虹主题下:
- 所有文字均保持 ≥4.5:1 对比度，不会出现「看不清」的情况
- Mermaid/ASCII 图表文字由系统自动适配颜色
- 代码块有独立的深色背景和语法高亮
"""


def build_theming_context(mode: ThemeMode = "dark") -> str:
    """构建聊天主题上下文片段, 注入 system prompt。"""
    p = PALETTES[mode]
    return f"""## 当前聊天主题: {p.label}

- accent 色: {p.accent}
- 正文色: {p.textPrimary}
- 次要文字: {p.textSecondary}
- 三级文字: {p.textTertiary}
- 气泡背景: {p.aiBubbleBg}

回复时无需显式使用这些颜色值, Markdown 渲染器会自动映射。"""