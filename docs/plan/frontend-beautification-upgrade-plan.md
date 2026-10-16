# TraceOS 前端美化升级专业方案

> **核心目标**：将当前「功能完整但展示分散」的 7 大可视化模块，升级为「电影级视觉、统一设计语言、流畅动画过渡」的专业可观测平台前端。
>
> **设计理念**：融合 **Apple Liquid Glass · Grafana Dashboard · Datadog APM · Chrome DevTools · Stripe Minions Dashboard** 等专业产品的设计精髓，构建适合操作系统教学场景的「Kernel Terminal 2.0」设计体系。

---

## 一、现状评估

### 1.1 已有资产

TraceOS 前端具备相当扎实的基础设施：

| 层面 | 资产 | 成熟度 |
|------|------|--------|
| **框架** | Next.js 14 + React 18 + TypeScript + Zustand | ✅ 成熟 |
| **样式** | Tailwind CSS 3 + shadcn/ui (base-nova) | ✅ 成熟 |
| **设计系统** | Kernel Terminal (`.kt-*`) + Glass Lab 动态毛玻璃 | ✅ 成熟 |
| **主题** | 4 套主题 (浅白/暗黑/暖黄/墨蓝) CSS 变量驱动 | ✅ 成熟 |
| **动画** | 50+ CSS 关键帧动画 + @react-spring/three | ✅ 丰富 |
| **图表** | ECharts 5.5 + Three.js + React Three Fiber | ✅ 成熟 |
| **图标** | lucide-react 完整图标库 | ✅ 成熟 |
| **其他** | canvas-confetti · shadcn/ui 组件 · Monaco Editor | ✅ 成熟 |

### 1.2 核心差距

对标 **2025-2026 年前端设计前沿**（Grafana 12 · shadcn/ui Dashboards · Glassmorphism Dark-First），TraceOS 存在以下差距：

| 差距 | 严重度 | 行业对标 |
|------|--------|---------|
| **ECharts 主题不联动** — 图表颜色硬编码，与暗黑/浅白/暖黄/墨蓝主题不联动 | 🔴 致命 | Grafana 仪表盘自动跟随组织主题 |
| **无 Framer Motion** — 面板切换无过渡动画，全是瞬间替换 | 🔴 致命 | Chrome DevTools 面板切换有流畅过渡 |
| **无骨架屏** — 面板加载用简单 spinner | 🟡 重要 | shadcn/ui 生态标准组件 |
| **无空状态规范** — 无数据时缺少插图+引导文案 | 🟡 重要 | Datadog "No Data" 有 SVG 插画 + 建议操作 |
| **无动画数字计数器** — KPI 数值无滚动动画 | 🟡 重要 | Grafana stat 面板有数字过渡 |
| **面板 Header 不统一** — 各面板自行实现标题栏 | 🟡 重要 | Datadog 统一面板 chrome |
| **无跨面板联动动画** — 时间轴拖动其他面板瞬间跳转 | 🟡 重要 | Grafana 面板联动平滑过渡 |
| **缺少 Neon Dark 主题** — 未覆盖 2025 赛博朋克终端美学 | 🟢 增强 | Metropolis TUI · SkyWalking Horizon · shadcn Gaussian themes |
| **无交互式 Onboarding** — 首次使用无引导 | 🟢 增强 | Datadog 有 guided tour |
| **响应式不足** — 小屏幕面板布局溢出 | 🟢 增强 | — |

### 1.3 7 大模块视觉现状

| 模块 | 当前视觉 | 美化空间 |
|------|---------|---------|
| **eBPF 追踪面板** (7 Tab) | ECharts + 自定义 UI，Tab 切换无动画 | Tab AnimatePresence + ECharts 主题联动 + PanelHeader 统一 |
| **火焰图面板** | SVG 交互渲染，硬编码色彩 | ECharts 主题化 + Framer Motion 弹性交互 |
| **系统 Trace 面板** | 瀑布图 + 表格，双视图 | 视图切换动画 + 骨架屏 + 空状态 |
| **内存 3D** | Three.js 3D，react-spring 动画 | 交互增强 (点击详情动画) + 泄漏高亮辉光 |
| **资源监控** | ECharts gauge + 趋势图 | AnimatedCounter 数值 + Grafana 风格响应式网格 |
| **AI 诊断面板** | 文字报告 + 雷达图 | PanelHeader + 骨架屏 + 报告段落交错淡入 |
| **AI 提问面板** | 聊天界面，功能完整 | 消息逐条滑入 + 打字光标 + 实验上下文栏折叠动画 |

---

## 二、设计体系升级：Kernel Terminal 2.0

### 2.1 设计理念

```
Kernel Terminal 1.0 (当前):
  暗黑终端风格 + 毛玻璃面板 + CSS 动画
              ↓
Kernel Terminal 2.0 (目标):
  5 主题系统 + ECharts 深度联动 + Framer Motion 动画
  + 统一组件库 + 流畅微交互 + 赛博朋克终端美学
```

### 2.2 五主题色彩系统

| 主题 | 主色 (Cyan) | 辅助色 (Purple) | 成功色 | 背景 | 适用场景 |
|------|-----------|----------------|--------|------|---------|
| **浅白** (Light) | `#0071e3` (苹果蓝) | `#8b5cf6` | `#30d158` | `#f5f5f7` | 白天教学 |
| **暗黑** (Dark) | `#00D4FF` (青蓝) | `#BF5AF2` | `#30D158` | `#0A0A0F` | 夜间调试 |
| **暖黄** (Warm) | `#d97706` (琥珀) | `#a855f7` | `#16a34a` | `#faf3e6` | 长时间阅读 |
| **墨蓝** (Slate) | `#38bdf8` (天蓝) | `#a78bfa` | `#34d399` | `#1e293b` | 数据密集 |
| **霓虹** (Neon) 🆕 | `#00ff41` (矩阵绿) | `#bf5af2` | `#39ff14` | `#0a0a0f` | 终端美学 |

所有 ECharts 图表自动跟随主题切换，颜色/背景/网格线/工具提示全部动态联动。

### 2.3 ECharts 主题深度联动

**实现原理**：

```
CSS 变量 (--kt-cyan 等)
    ↓ getComputedStyle() 实时读取
ECharts Theme JSON (动态生成)
    ↓ echarts.registerTheme("kt-dynamic", theme)
图表组件 (useEChart hook)
    ↓ echarts.init(dom, "kt-dynamic")
自动跟随主题变化
```

**关键绑定**：

- 10 色图表调色板 = Cyan → Amber → Green → Purple → Red → ...
- 坐标轴颜色 = `--kt-border`
- 网格线颜色 = `--kt-border` (dashed)
- 文字颜色 = `--kt-text-secondary` / `--kt-text-tertiary`
- 背景色 = transparent (继承面板背景)
- Tooltip = `--kt-bg-card` + `--kt-border` 圆角毛玻璃

### 2.4 动画系统分层

| 层级 | 技术 | 用途 |
|------|------|------|
| **CSS 动画** | `@keyframes` + Tailwind | 微交互 (hover, pulse, shimmer)、骨架屏 |
| **Framer Motion** | `motion.div` + `AnimatePresence` | 面板切换、列表入场、拖拽手势 |
| **Three.js** | `@react-spring/three` | 3D 动画 (内存布局、锁力导向图) |
| **ECharts** | `emphasis` + `animation` 配置 | 图表hover高亮、数据更新过渡 |
| **canvas-confetti** | 第三方库 | 提交成功礼花效果 |

---

## 三、新增组件库

### 3.1 组件清单

为统一各模块视觉语言，新增以下共享组件：

#### PanelHeader — 统一面板头部

```
┌─────────────────────────────────────────────────┐
│ 🔷 eBPF 追踪 │ 实时系统调用 │ [LIVE]  [↻] [⚙]   │
├─────────────────────────────────────────────────┤
│                                                  │
```

- `icon`: Lucide 图标
- `title` + `subtitle`: 标题和副标题
- `badge`: 状态标签 (pulse/solid/outline 三种变体，支持 success/warning/error/info/neutral 五种色调)
- `actions`: 操作按钮组

#### Skeleton 骨架屏系统

- **SkeletonKpiCard**: KPI 卡片骨架（图标+标题+大数值+趋势线）
- **SkeletonChart**: 图表骨架（标题栏+6条柱状shimmer+坐标轴）
- **SkeletonTable**: 表格骨架（表头+5行数据shimmer）
- **SkeletonText**: 文本块骨架（多行段落shimmer）

所有骨架屏使用 `.shimmer` 类实现流动光泽效果，支持 `animate-pulse` 呼吸动画。

#### EmptyState — 统一空状态

| 变体 | 图标 | 默认标题 | 默认描述 |
|------|------|---------|---------|
| `no-data` | Database | 暂无数据 | 运行程序后，数据将在此处展示 |
| `no-results` | Search | 未找到匹配结果 | 尝试调整筛选条件或搜索关键词 |
| `no-activity` | Activity | 暂无活动 | 当前没有实时事件，启动程序后会自动刷新 |
| `error` | ServerCrash | 加载失败 | 数据请求遇到问题，请稍后重试 |

支持 compact 模式（小面板内嵌）和 action 插槽（操作按钮）。

#### AnimatedCounter — 动画数字计数器

- 使用 Framer Motion `useSpring` 实现数字平滑滚动
- 支持 `prefix` / `suffix` / `decimals` / `duration`
- IntersectionObserver 触发入场动画
- 配套 `StatChange` 组件：↑ green / ↓ red 箭头 + 百分比变化

#### StatusBadge — 状态指示器

| 变体 | 颜色 | 动画 | 默认文字 |
|------|------|------|---------|
| `live` | 绿点 + 脉冲 | ping + 呼吸 | LIVE |
| `running` | 青点 + 脉冲 | ping + 呼吸 | RUN |
| `success` | 绿点 | 静态 | OK |
| `warning` | 琥珀点 | 静态 | WARN |
| `error` | 红点 | 静态 | ERR |
| `idle` | 灰点 | 静态 | IDLE |
| `offline` | 灰点 | 静态 | OFF |
| `pending` | 琥珀点 | 静态 | PEND |

支持 `dotOnly` 模式（仅显示点）、`sm/md/lg` 尺寸、`pulse` 控制。

#### ConnectionStatus — 连接状态（SSE/WebSocket）

基于 StatusBadge，自动根据 `connected: boolean` 切换 live/offline 状态。

---

## 四、交互微动效方案

### 4.1 动效清单

| 位置 | 动效描述 | 技术实现 | 时长 |
|------|---------|---------|------|
| **Dock 按钮 hover** | scale(1.05) + 辉光增强 | Framer Motion `whileHover` | 200ms |
| **Dock 按钮 active** | 底部指示条弹性滑入 + 外发光 | CSS `::after` + Framer Motion | 250ms |
| **面板打开** | 从底部弹性滑入 (spring) | Framer Motion `spring` | 400ms |
| **面板关闭** | 滑出 + 淡出 | `AnimatePresence exit` | 250ms |
| **Tab 切换** | 方向感知滑入/滑出 | `AnimatePresence` + `x` 偏移 | 300ms |
| **KPI 卡片进入** | 交错淡入上移 (stagger 80ms) | CSS `stagger-children` | 400ms×N |
| **实时数据更新** | 数值微缩弹跳 (pulse scale) | Framer Motion `useSpring` | 300ms |
| **数据错误** | 卡片水平微震 (shake) | Framer Motion `x: [0,±4,0]` | 400ms |
| **提交成功** | 礼花(confetti) + 成功脉冲 | canvas-confetti + `kt-success-pulse` | 2000ms |
| **图表 hover** | 数据点放大 + tooltip 淡入 | ECharts emphasis + Framer Motion | 150ms |
| **滚动加载** | 骨架屏 shimmer → 内容 crossfade | CSS shimmer + Framer Motion | 800ms |
| **连接状态变化** | 状态点颜色渐变过渡 | CSS `transition` | 300ms |
| **SSE 事件到达** | 列表项从右滑入 + 高亮渐隐 | Framer Motion + CSS | 500ms |
| **跨面板时间同步** | 其他面板内容平滑滚动到目标 | Framer Motion `useMotionValue` | 400ms |
| **代码行高亮** | 问题行背景闪烁 3 次 | CSS `kt-error-pulse` | 500ms×3 |

### 4.2 性能策略

| 策略 | 说明 |
|------|------|
| **GPU 加速** | 仅动画 `transform` 和 `opacity`，不触发布局重计算 |
| **will-change** | 仅在动画元素上按需设置，动画结束后移除 |
| **prefers-reduced-motion** | 尊重系统偏好，全部动画降级为 0.01ms |
| **Performance Mode** | 已有 `kt-perf-mode`，禁用所有非必要动画 |
| **Animation Speed** | 已有 `--kt-anim-speed` CSS 变量，全局可控 |
| **Lazy 图表** | 非可视区域图表不渲染，IntersectionObserver 懒加载 |

---

## 五、各模块美化升级要点

### 5.1 eBPF 追踪面板 (7 Tab)

**当前**：Tab 切换瞬间替换，ECharts 色彩硬编码，无加载状态。

**升级**：
1. PanelHeader 统一标题栏：`<PanelHeader icon={Activity} title="eBPF 追踪" subtitle="实时系统调用" badge={{ label: "LIVE", variant: "pulse", tone: "success" }} />`
2. 7 个 Tab 内容区包裹 `AnimatePresence`，方向感知滑入/滑出
3. 概览/时间线/内存/锁分析 4 个含 ECharts 的 Tab，图表使用 `kt-dynamic` 主题
4. 数据加载中显示 SkeletonChart / SkeletonTable
5. 无数据时显示 EmptyState variant="no-data"
6. SSE 连接状态使用 ConnectionStatus 组件

### 5.2 火焰图面板

**当前**：SVG 渲染，单一样式，无动画交互。

**升级**：
1. PanelHeader：`<PanelHeader icon={Flame} title="火焰图" subtitle="CPU 热点分析" />`
2. 火焰图色块 hover：Framer Motion `whileHover={{ scale: 1.02, y: -2 }}`
3. 源码跳转弹层：`AnimatePresence` + scaleIn 动画
4. 差分火焰图红/蓝着色跟随主题调整饱和度
5. 内存火焰图：宽度 = 分配字节数，颜色 = `--kt-green` → `--kt-red` 渐变

### 5.3 系统 Trace 面板

**当前**：瀑布图 + 表格双视图，视图切换无动画。

**升级**：
1. PanelHeader：`<PanelHeader icon={GanttChart} title="系统 Trace" subtitle="调用时间线" />`
2. 6 个视图 (泳道/Span树/状态/调度/表格/AI) 使用 AnimatePresence 切换
3. 多线程泳道：每条泳道用 Framer Motion `layout` 自动适应数据变化
4. Span 树：使用 `motion.div` 逐层展开，stagger 50ms
5. 线程状态机：状态切换使用 `layout` 宽度动画
6. 时间轴缩放/拖拽：使用 Framer Motion `useDrag` + `useTransform`

### 5.4 内存 3D 地图 + 资源监控

**当前**：Three.js 3D 渲染不错，但 2D 资源监控面板视觉较平淡。

**升级**：
1. 3D 区域点击：弹出详情面板使用 Framer Motion scaleIn
2. 内存泄漏高亮：红色辉光 `boxShadow: glow` 动画
3. 快照对比：左右分屏使用 AnimatePresence mode="wait"
4. Grafana 风格仪表盘：KPI 卡片使用 AnimatedCounter + StatChange
5. 资源异常告警：StatusBadge variant="warning" + 卡片微震
6. 事件标注：时间轴上标注气泡使用 Framer Motion hover 放大

### 5.5 AI 诊断面板

**当前**：文字报告 + 雷达图，功能完整但展示平淡。

**升级**：
1. PanelHeader：`<PanelHeader icon={Brain} title="AI 诊断" subtitle="多 Agent 综合评估" badge={{ label: "AUTO", variant: "solid", tone: "info" }} />`
2. 六维雷达图：ECharts 使用 `kt-dynamic` 主题，雷达图填充色半透明
3. 证据链列表：逐条 Framer Motion `fadeInUp` + stagger
4. 概念达成度柱状图：ECharts 主题自适应
5. 加载中显示 SkeletonText + SkeletonChart
6. 低置信度警告：StatusBadge variant="warning" + 报告顶部闪烁条

### 5.6 AI 提问面板

**当前**：聊天界面，功能完整，刷新即丢历史。

**升级**：
1. PanelHeader：`<PanelHeader icon={MessageCircle} title="AI 教学助手" subtitle="苏格拉底式引导" badge={{ label: "L1", variant: "outline", tone: "neutral" }} />`
2. 消息气泡：Framer Motion 逐条滑入 (stagger 100ms)，AI 消息从左侧、用户消息从右侧
3. 实验上下文栏：使用 `AnimatePresence` 折叠/展开
4. AI 思考过程：打字指示器（`.typing-cursor`） + "正在分析..."
5. 推荐问题：以 chip 形式展示，点击后弹性缩放
6. 空状态：`<EmptyState variant="no-activity" title="开始提问" description="向 AI 教学助手提问关于实验的任何问题" />`

### 5.7 锁分析 / 死锁图

**当前**：ECharts 力导向图。

**升级**：
1. PanelHeader：`<PanelHeader icon={Network} title="锁分析" badge={{ label: "DEADLOCK", variant: "pulse", tone: "error" }} />`
2. 死锁节点：红色放大动画 + 脉冲辉光
3. 正常锁节点：根据类型着色（cyan = mutex, purple = rwlock, amber = spinlock）
4. 死锁演化回放：步骤指示器 + Framer Motion 步骤切换
5. Coffman 四条件：逐条 checked 动画

---

## 六、跨模块联动动画

### 6.1 统一时间轴

所有模块共享 `workspaceStore.syncedTimestamp`：

```
用户拖动 Trace 时间轴
    ↓ setSyncedTimestamp(t)
其他面板监听 syncedTimestamp
    ↓ 平滑滚动到对应时刻
火焰图: ECharts dataZoom 动画跳转
内存3D: 回放到对应快照
锁图: 切换到对应时刻的锁状态
资源监控: 十字线标注
```

动画使用 Framer Motion `useSpring` 实现平滑插值，避免瞬间跳转。

### 6.2 事件高亮联动

```
用户点击 eBPF 面板中的异常事件
    ↓ setHighlightedEvent(event)
所有面板响应:
    ↓
Trace: 时间轴上高亮标记点
火焰图: 高亮对应函数调用
内存3D: 高亮对应分配点
锁图: 高亮相关线程
```

---

## 七、响应式适配

### 7.1 断点策略

| 断点 | 布局 | 面板行为 |
|------|------|---------|
| ≥ 1440px | 三栏 (editor | center | right) | 全部展开 |
| 1024-1439px | 双栏 (editor + panels) | right sidebar 折叠 |
| 768-1023px | 单栏 + Dock | 面板从底部滑出 |
| < 768px | 全屏堆叠 | 面板全屏覆盖 |

### 7.2 移动端适配

- Dock 按钮收缩为 40px 圆角图标
- 面板全屏时隐藏 editor，退出面板恢复
- KPI 卡片 4 列 → 2 列
- 图表最小高度 200px
- 所有触摸目标 ≥ 44px

---

## 八、技术实现清单

### 8.1 已安装依赖

```
framer-motion ^13.0  ← 新增
echarts 5.5          ← 已有
react-resizable-panels ← 已有
@react-spring/three  ← 已有
lucide-react         ← 已有
canvas-confetti      ← 已有
```

### 8.2 新增文件

| 文件 | 说明 |
|------|------|
| `lib/echarts-theme.ts` | ECharts 主题与 KT 设计系统联动引擎 |
| `components/ui/panel-header.tsx` | 统一面板头部 (PanelHeader + PanelHeaderAction) |
| `components/ui/skeleton-card.tsx` | 骨架屏系统 (KpiCard/Chart/Table/Text) |
| `components/ui/empty-state.tsx` | 统一空状态 + InlineLoading |
| `components/ui/animated-counter.tsx` | 动画数字计数器 + StatChange |
| `components/ui/status-badge.tsx` | 状态指示器 (StatusBadge + ConnectionStatus) |

### 8.3 修改文件

| 文件 | 修改 |
|------|------|
| `package.json` | 添加 `framer-motion` |
| `components/ui/index.ts` | 导出所有新组件 |
| `lib/themes.ts` | 新增 Neon Dark 主题 (+ NEON_VARS) |
| `app/globals.css` | 新增 Neon Dark CSS 变量（与 JS 保持同步） |
| `stores/workspace.ts` | 新增 crossPanelSync/highlightedEvent/syncedTimestamp 状态 |

### 8.4 待升级面板文件 (后续实施)

| 文件 | 美化要点 |
|------|---------|
| `panels/EBPFTracePanel.tsx` | PanelHeader + AnimatePresence Tab + ECharts 主题 + 骨架屏 + 空状态 |
| `panels/FlameGraphPanel.tsx` | PanelHeader + ECharts 主题 + Framer Motion hover |
| `panels/TraceViewer.tsx` | PanelHeader + AnimatePresence 视图切换 |
| `panels/WaterfallTimeline.tsx` | 时间轴 Framer Motion 拖拽 |
| `panels/MemoryLayout3D.tsx` | 点击详情弹层动画 + 泄漏高亮辉光 |
| `DeadlockGraph.tsx` | ECharts 主题 + 死锁节点脉冲动画 |
| `DiagnosisPanel.tsx` | PanelHeader + 骨架屏 + 证据链 stagger |
| `AIChatPanel.tsx` | PanelHeader + 消息气泡滑入 + 上下文栏折叠 |
| `RightStatusCards.tsx` | AnimatedCounter + StatChange + 交错入场 |
| `FloatingDock.tsx` | 微动效升级 (Framer Motion whileHover) |

---

## 九、对标专业产品验证清单

| 专业产品 | 设计要素 | TraceOS 对应实现 |
|---------|---------|-----------------|
| **Grafana 12** | 主题联动 + Dashboard-as-code | KT 5 主题 + ECharts 自动注册 |
| **Datadog APM** | 统一面板 chrome + 事件关联 | PanelHeader + ObsContext 事件总线 |
| **Chrome DevTools** | 多泳道 + 缩放拖拽 | 多线程泳道 + time scrubber |
| **Pixie (New Relic)** | Service Map + Scriptable | ProcessMap 拓扑图 |
| **Pyroscope** | 持续 profiling + 标签 | 持续 profiling 时间轴 |
| **Jaeger** | Span 四视图 + 对比 | Span 树/Flame/Stat/Table |
| **Metropolis TUI** | 赛博朋克终端美学 | Neon Dark 主题 |
| **shadcn/ui dashboards** | 骨架屏 + 空状态 + 响应式网格 | 新组件系统 |
| **Stripe Dashboard** | 动画计数器 + 微交互 | AnimatedCounter + Framer Motion |
| **Apple Liquid Glass** | 毛玻璃 + 动态模糊 | Glass Lab (blur/saturate/noise) |

---

## 十、实施优先级

### 🔴 P0 — 基础设施（已完成）

- [x] 安装 Framer Motion
- [x] ECharts 主题联动引擎 (`lib/echarts-theme.ts`)
- [x] 统一 PanelHeader 组件
- [x] 骨架屏系统 (KpiCard/Chart/Table/Text)
- [x] 空状态组件
- [x] 动画数字计数器
- [x] 状态指示器 (StatusBadge + ConnectionStatus)
- [x] Neon Dark 主题 (5 → 5 主题)
- [x] Cross-panel sync 状态 (workspace store)
- [x] 组件导出 (ui/index.ts)

### 🟡 P1 — 面板升级（下一步）

- [ ] eBPF 追踪面板美化：PanelHeader + AnimatePresence + ECharts 主题 + 骨架屏 + 空状态
- [ ] 火焰图面板美化：PanelHeader + ECharts 主题 + Framer Motion hover
- [ ] Trace 面板美化：PanelHeader + AnimatePresence 视图切换
- [ ] 内存 3D + 资源监控美化：点击详情弹层 + 泄漏高亮 + KPI 计数器
- [ ] AI 诊断面板美化：PanelHeader + 骨架屏 + 证据链 stagger
- [ ] AI 提问面板美化：PanelHeader + 消息气泡滑入 + 上下文栏折叠
- [ ] 锁分析面板美化：ECharts 主题 + 死锁脉冲动画

### 🟢 P2 — 体验增强

- [ ] 响应式面板布局 (768px / 1024px / 1440px 断点)
- [ ] 交互式新手引导 (Driver.js 或 自研 Onboarding)
- [ ] 教师端 Dashboard 美化
- [ ] 知识库页面美化
- [ ] 主题切换动画 (crossfade 300ms)

---

## 十一、效果验证

### 11.1 验证方法

1. **构建验证**：`cd frontend && npm run build` — TypeScript + Next.js 编译通过
2. **Lint 验证**：`npm run lint` — ESLint 通过
3. **测试验证**：`npm test` — Vitest 现有测试通过
4. **视觉验证**：
   - 5 套主题下 ECharts 图表颜色正确联动
   - 面板 Tab 切换有流畅过渡动画 (AnimatePresence)
   - 骨架屏 → 内容过渡自然 (shimmer + crossfade)
   - 空状态组件正确渲染 (4 种变体)
   - Dock 按钮 hover/active 动效流畅 (60fps)
   - 数字计数器进入视口时触发动画
   - StatusBadge live/running 变体有脉冲动画
   - `prefers-reduced-motion` 时所有动画静止

### 11.2 性能指标

| 指标 | 目标 |
|------|------|
| Framer Motion bundle 增量 | < 30KB gzipped |
| 面板动画帧率 | 60fps |
| 主题切换延迟 | < 50ms (CSS Variables 瞬时) |
| ECharts 主题重注册 | < 10ms |
| 骨架屏首屏渲染 | < 100ms |

---

*文档版本 v1.0 | 创建日期 2026-08-06*
*关联文档: 本方案配套实施已完成的代码修改见 frontend/ 目录下新增文件和修改*
