package services

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/traceos-lab/core-service/internal/types"
)

// ObsContextInjector serializes ObsContext into AI-consumable structured context.
// Design references:
//   - Context Firewall: each agent receives only its domain slice
//   - 40% token budget (Anthropic Context Anxiety threshold)
//   - Progressive disclosure: Tier 1 → Tier 2 → Tier 3
//   - OTel GenAI semantic convention alignment

const (
	// Token budget in estimated tokens (4 char ≈ 1 token)
	MaxDiagnosisTokens = 40000  // Full structured injection for diagnosis agents
	MaxChatTokens      = 8000   // Summarized for interactive chat (progressive disclosure)
	CharsPerToken      = 4
)

// AgentDomain defines the data fields each agent is allowed to see.
type AgentDomain struct {
	Name       string
	Fields     []string // dot-separated field paths, e.g. "health_score.score"
	MaxTokens  int
}

// AgentDomains maps agent names to their data access permissions (Context Firewall).
var AgentDomains = map[string]AgentDomain{
	"code_analyzer": {
		Name:      "code_analyzer",
		Fields:    []string{"submission_id", "experiment_type", "language", "health_score", "source_annotations"},
		MaxTokens: 8000,
	},
	"test_evaluator": {
		Name:      "test_evaluator",
		Fields:    []string{"submission_id", "experiment_type", "health_score", "red_metrics", "use_metrics", "anomaly_summary"},
		MaxTokens: 8000,
	},
	"syscall_analyzer": {
		Name:      "syscall_analyzer",
		Fields:    []string{"submission_id", "experiment_type", "syscall_traces", "process_graph", "event_annotations", "risk_indicators"},
		MaxTokens: 12000,
	},
	"concept_rubric": {
		Name:      "concept_rubric",
		Fields:    []string{"submission_id", "experiment_type", "source_annotations", "health_score", "concept_tags"},
		MaxTokens: 6000,
	},
	"evaluator": {
		Name:      "evaluator",
		Fields:    []string{"submission_id", "experiment_type", "health_score", "risk_indicators", "anomaly_summary", "diff_vs_baseline"},
		MaxTokens: 6000,
	},
	"diagnosis_orchestrator": {
		Name:      "diagnosis_orchestrator",
		Fields:    []string{"*"},
		MaxTokens: MaxDiagnosisTokens,
	},
	"chat_agent": {
		Name:      "chat_agent",
		Fields:    []string{"submission_id", "experiment_type", "language", "health_score", "anomaly_summary", "syscall_traces", "flamegraph", "memory_snapshots", "lock_events", "event_annotations", "risk_indicators", "concept_tags"},
		MaxTokens: MaxChatTokens,
	},
}

// InjectForDiagnosis produces a full, structured JSON injection for AI diagnosis agents.
// This is the "fire hose" — complete ObsContext with semantic labels for deep analysis.
func (b *ObsContextBuilder) InjectForDiagnosis(ctx *types.ObsContext, agentName string) (string, error) {
	domain, ok := AgentDomains[agentName]
	if !ok {
		return "", fmt.Errorf("unknown agent: %s", agentName)
	}

	// Build domain-specific slice
	slice := b.buildDomainSlice(ctx, domain)

	// Add semantic labels and teaching hints
	enriched := b.enrichWithSemantics(slice, ctx)

	// Check token budget
	tokens := estimateTokens(enriched)
	if tokens > domain.MaxTokens {
		enriched = b.truncateToBudget(enriched, domain.MaxTokens)
	}

	return enriched, nil
}

// InjectForChat produces a summarized, progressive-disclosure context for AI chat agents.
// Tier 1 is always included; Tier 2/3 are disclosed on demand or when anomaly score is high.
func (b *ObsContextBuilder) InjectForChat(ctx *types.ObsContext, tier int) (string, error) {
	domain := AgentDomains["chat_agent"]

	var parts []string

	// Tier 1 — always included (compact form)
	parts = append(parts, b.formatTier1Compact(ctx))

	// Tier 2 — included when tier >= 2 or anomaly count > 0
	if tier >= 2 || ctx.HealthScore.ActiveAnomalies > 0 {
		parts = append(parts, b.formatTier2Compact(ctx))
	}

	// Tier 3 — included when tier >= 3
	if tier >= 3 {
		parts = append(parts, b.formatTier3Compact(ctx))
	}

	result := strings.Join(parts, "\n\n")
	tokens := estimateTokens(result)
	if tokens > domain.MaxTokens {
		result = b.truncateToBudget(result, domain.MaxTokens)
	}

	return result, nil
}

// InjectAsJSON exports the full ObsContext as a JSON string with semantic annotations.
func (b *ObsContextBuilder) InjectAsJSON(ctx *types.ObsContext) (string, error) {
	// Deep copy and enrich
	enriched := *ctx

	// Add semantic labels to syscall events
	for i := range enriched.SyscallTraces {
		if enriched.SyscallTraces[i].SemanticLabel == "" {
			b.applySemanticLabel(&enriched.SyscallTraces[i])
		}
	}

	// Add concept tags
	enriched.ConceptTags = b.generateConceptTags(ctx)

	data, err := json.Marshal(enriched)
	if err != nil {
		return "", fmt.Errorf("failed to marshal ObsContext: %w", err)
	}

	return string(data), nil
}

// buildDomainSlice extracts only the fields allowed by the agent's domain.
func (b *ObsContextBuilder) buildDomainSlice(ctx *types.ObsContext, domain AgentDomain) string {
	// "*" means full access
	for _, f := range domain.Fields {
		if f == "*" {
			data, _ := json.Marshal(ctx)
			return string(data)
		}
	}

	// Build a filtered map
	raw, _ := json.Marshal(ctx)
	var full map[string]interface{}
	json.Unmarshal(raw, &full)

	filtered := make(map[string]interface{})
	for _, field := range domain.Fields {
		if val, ok := full[field]; ok {
			filtered[field] = val
		}
	}

	data, _ := json.Marshal(filtered)
	return string(data)
}

// enrichWithSemantics adds semantic labels, teaching hints, and concept mappings.
func (b *ObsContextBuilder) enrichWithSemantics(slice string, ctx *types.ObsContext) string {
	var sb strings.Builder

	// Header with experiment metadata
	sb.WriteString(fmt.Sprintf("# TraceOS 观测诊断上下文\n"))
	sb.WriteString(fmt.Sprintf("**实验类型**: %s | **提交ID**: %s\n", ctx.ExperimentType, ctx.SubmissionID))
	sb.WriteString(fmt.Sprintf("**时间跨度**: %s → %s\n\n", ctx.TimelineStart.Format(time.RFC3339), ctx.TimelineEnd.Format(time.RFC3339)))

	// Tier 1 summary
	sb.WriteString(fmt.Sprintf("## 健康概览 (Tier 1)\n"))
	sb.WriteString(fmt.Sprintf("- 健康评分: %d/100 (%s)\n", ctx.HealthScore.Score, ctx.HealthScore.TrendDirection))
	sb.WriteString(fmt.Sprintf("- 活跃异常: %d\n", ctx.HealthScore.ActiveAnomalies))
	sb.WriteString(fmt.Sprintf("- RED: 请求率 %.1f/s, 错误率 %.1f%%, P95=%.1fms\n",
		ctx.REDMetrics.RequestRate, ctx.REDMetrics.ErrorRate, ctx.REDMetrics.DurationP95))
	sb.WriteString(fmt.Sprintf("- USE: CPU %.1f%%, Mem %.1f%%, I/O %.1f%%\n\n",
		ctx.USEMetrics.CPUUtilization, ctx.USEMetrics.MemUtilization, ctx.USEMetrics.IOUtilization))

	// Anomaly digest
	if len(ctx.AnomalySummary) > 0 {
		sb.WriteString("### 检测到的问题\n")
		for _, a := range ctx.AnomalySummary {
			sb.WriteString(fmt.Sprintf("- [%s] %s: %s (面板: %s)\n",
				a.Severity, a.Type, a.Summary, a.LinkToTier2Panel))
		}
		sb.WriteString("\n")
	}

	// Semantic labels
	sb.WriteString("### 系统调用语义标注\n")
	grouped := b.groupBySemanticLabel(ctx.SyscallTraces)
	for label, events := range grouped {
		sb.WriteString(fmt.Sprintf("- **%s**: %d 次调用\n", label, len(events)))
	}
	sb.WriteString("\n")

	// Risk indicators
	if ctx.RiskIndicators != nil {
		sb.WriteString("### 复合风险指标\n")
		sb.WriteString(fmt.Sprintf("- 饱和度指数: %.2f\n", ctx.RiskIndicators.SaturationIndex))
		sb.WriteString(fmt.Sprintf("- 依赖风险: %.2f\n", ctx.RiskIndicators.DependencyRisk))
		sb.WriteString(fmt.Sprintf("- OOM风险: %.2f\n", ctx.RiskIndicators.OOMRiskRate))
		sb.WriteString("\n")
	}

	// Append raw slice
	sb.WriteString("## 原始结构化数据 (JSON)\n```json\n")
	sb.WriteString(slice)
	sb.WriteString("\n```\n")

	return sb.String()
}

// formatTier1Compact produces a compact Tier 1 summary for chat.
func (b *ObsContextBuilder) formatTier1Compact(ctx *types.ObsContext) string {
	var sb strings.Builder
	sb.WriteString("## 运行概览\n")
	sb.WriteString(fmt.Sprintf("健康评分: %d/100 | 趋势: %s | 异常: %d\n",
		ctx.HealthScore.Score, ctx.HealthScore.TrendDirection, ctx.HealthScore.ActiveAnomalies))
	sb.WriteString(fmt.Sprintf("错误率: %.1f%% | P95延迟: %.1fms | CPU: %.1f%% | 内存: %.1f%%\n",
		ctx.REDMetrics.ErrorRate, ctx.REDMetrics.DurationP95,
		ctx.USEMetrics.CPUUtilization, ctx.USEMetrics.MemUtilization))

	if len(ctx.AnomalySummary) > 0 {
		sb.WriteString("检测到的问题:\n")
		for _, a := range ctx.AnomalySummary {
			sb.WriteString(fmt.Sprintf("  - [%s] %s: %s\n", a.Severity, a.Type, a.Summary))
		}
	}
	return sb.String()
}

// formatTier2Compact produces a compact Tier 2 summary for chat.
func (b *ObsContextBuilder) formatTier2Compact(ctx *types.ObsContext) string {
	var sb strings.Builder
	sb.WriteString("## 进程分析\n")
	sb.WriteString(fmt.Sprintf("系统调用总数: %d\n", len(ctx.SyscallTraces)))
	sb.WriteString(fmt.Sprintf("锁事件: %d | 内存快照: %d\n", len(ctx.LockEvents), len(ctx.MemorySnapshots)))

	if ctx.FlameGraph != nil {
		sb.WriteString(fmt.Sprintf("火焰图: %d 样本 | 热点函数: %d\n",
			ctx.FlameGraph.TotalSamples, len(ctx.FlameGraph.HotFunctions)))
		if len(ctx.FlameGraph.HotFunctions) > 0 {
			sb.WriteString("Top 3 热点:\n")
			for i, h := range ctx.FlameGraph.HotFunctions {
				if i >= 3 {
					break
				}
				sb.WriteString(fmt.Sprintf("  - %s (%.1f%%, %d samples)\n", h.Name, h.Percentage, h.Samples))
			}
		}
	}

	if ctx.ProcessGraph != nil {
		sb.WriteString(fmt.Sprintf("进程拓扑: %d 进程, %d 线程, %d IPC\n",
			ctx.ProcessGraph.Metadata.TotalProcesses,
			ctx.ProcessGraph.Metadata.TotalThreads,
			ctx.ProcessGraph.Metadata.TotalIPC))
	}

	return sb.String()
}

// formatTier3Compact produces a compact Tier 3 summary for chat.
func (b *ObsContextBuilder) formatTier3Compact(ctx *types.ObsContext) string {
	var sb strings.Builder
	sb.WriteString("## 函数级分析\n")

	if len(ctx.CallChains) > 0 {
		sb.WriteString(fmt.Sprintf("调用链: %d 条 | 最长延迟: %dns\n",
			len(ctx.CallChains), ctx.CallChains[0].TotalLatencyNs))
	}
	if len(ctx.SourceAnnotations) > 0 {
		sb.WriteString(fmt.Sprintf("源码标注: %d 处\n", len(ctx.SourceAnnotations)))
	}
	if len(ctx.RaceReports) > 0 {
		sb.WriteString(fmt.Sprintf("数据竞争: %d 处\n", len(ctx.RaceReports)))
	}
	if len(ctx.LeakReports) > 0 {
		sb.WriteString(fmt.Sprintf("内存泄漏: %d 处\n", len(ctx.LeakReports)))
	}
	if ctx.DeadlockEvolution != nil {
		sb.WriteString(fmt.Sprintf("死锁分析: %d 步\n", len(ctx.DeadlockEvolution.Steps)))
	}

	return sb.String()
}

// groupBySemanticLabel groups syscall events by their semantic label.
func (b *ObsContextBuilder) groupBySemanticLabel(traces []types.SyscallEvent) map[string][]types.SyscallEvent {
	groups := make(map[string][]types.SyscallEvent)
	for _, t := range traces {
		label := t.SemanticLabel
		if label == "" {
			label = t.Syscall
		}
		groups[label] = append(groups[label], t)
	}
	return groups
}

// generateConceptTags generates OS concept tags from the ObsContext.
func (b *ObsContextBuilder) generateConceptTags(ctx *types.ObsContext) []types.ConceptTag {
	var tags []types.ConceptTag
	seen := make(map[string]bool)

	syscallConcepts := map[string]types.ConceptTag{
		"fork":     {Name: "进程创建(fork)", ConceptID: "os-process-fork", Relevance: 0.9, LinkedField: "syscall_traces"},
		"clone":    {Name: "线程创建(clone)", ConceptID: "os-thread-clone", Relevance: 0.9, LinkedField: "syscall_traces"},
		"execve":   {Name: "程序加载(exec)", ConceptID: "os-process-exec", Relevance: 0.9, LinkedField: "syscall_traces"},
		"wait4":    {Name: "进程回收(wait)", ConceptID: "os-process-wait", Relevance: 0.9, LinkedField: "syscall_traces"},
		"mmap":     {Name: "内存映射(mmap)", ConceptID: "os-memory-mmap", Relevance: 0.8, LinkedField: "syscall_traces"},
		"brk":      {Name: "堆扩展(brk)", ConceptID: "os-memory-heap", Relevance: 0.8, LinkedField: "syscall_traces"},
		"futex":    {Name: "锁等待(futex)", ConceptID: "os-lock-futex", Relevance: 0.8, LinkedField: "syscall_traces"},
		"write":    {Name: "I/O写入", ConceptID: "os-io-write", Relevance: 0.7, LinkedField: "syscall_traces"},
		"read":     {Name: "I/O读取", ConceptID: "os-io-read", Relevance: 0.7, LinkedField: "syscall_traces"},
		"openat":   {Name: "文件打开", ConceptID: "os-fs-open", Relevance: 0.7, LinkedField: "syscall_traces"},
		"close":    {Name: "文件关闭", ConceptID: "os-fs-close", Relevance: 0.7, LinkedField: "syscall_traces"},
		"pipe2":    {Name: "管道IPC", ConceptID: "os-ipc-pipe", Relevance: 0.8, LinkedField: "syscall_traces"},
	}

	for _, t := range ctx.SyscallTraces {
		if tag, ok := syscallConcepts[t.Syscall]; ok {
			if !seen[tag.ConceptID] {
				tags = append(tags, tag)
				seen[tag.ConceptID] = true
			}
		}
	}

	// Add leak concept if leaks detected
	if len(ctx.LeakReports) > 0 {
		tags = append(tags, types.ConceptTag{
			Name: "内存泄漏", ConceptID: "os-memory-leak", Relevance: 0.95, LinkedField: "leak_reports",
		})
	}

	// Add deadlock concept
	if ctx.DeadlockEvolution != nil && len(ctx.DeadlockEvolution.Steps) > 0 {
		tags = append(tags, types.ConceptTag{
			Name: "死锁", ConceptID: "os-deadlock", Relevance: 0.95, LinkedField: "deadlock_evolution",
		})
	}

	// Add race concept
	if len(ctx.RaceReports) > 0 {
		tags = append(tags, types.ConceptTag{
			Name: "数据竞争", ConceptID: "os-concurrency-race", Relevance: 0.95, LinkedField: "race_reports",
		})
	}

	return tags
}

// truncateToBudget truncates text to fit within a token budget.
func (b *ObsContextBuilder) truncateToBudget(text string, maxTokens int) string {
	maxChars := maxTokens * CharsPerToken
	if len(text) <= maxChars {
		return text
	}

	// Smart truncation: keep header + key findings + tail
	head := maxChars * 3 / 4
	tail := maxChars / 4

	var result strings.Builder
	result.WriteString(text[:head])
	result.WriteString(fmt.Sprintf("\n\n... [上下文已截断 — 超出 %d token 预算] ...\n\n", maxTokens))
	if tail > 0 {
		tailStart := len(text) - tail
		if tailStart > head {
			result.WriteString("---\n")
			result.WriteString(text[tailStart:])
		}
	}
	return result.String()
}

func estimateTokens(text string) int {
	if len(text) == 0 {
		return 0
	}
	return (len(text) + CharsPerToken - 1) / CharsPerToken
}
