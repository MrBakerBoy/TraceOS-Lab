package services

import (
	"fmt"
	"strings"
)

// TeachingNarrativeEngine generates student-facing "teaching stories" from
// detected issues, turning raw diagnostic data into educational narratives.
//
// Design reference: G-EVAL Chain-of-Thought calibration + TraceOS Supraptive Method.
type TeachingNarrativeEngine struct {
	templates map[string]NarrativeTemplate
}

// NarrativeTemplate defines a story structure for a specific issue type.
type NarrativeTemplate struct {
	StoryTitle string   `json:"story_title"`
	Setup      string   `json:"setup"`
	Conflict   string   `json:"conflict"`
	Reveal     string   `json:"reveal"`
	FixStory   string   `json:"fix_story"`
	Lesson     string   `json:"lesson"`
}

// TeachingHint holds the three-level progressive hint system.
// L1: guide observation → L2: give direction → L3: full explanation
type TeachingHint struct {
	Level         int      `json:"level"`
	Hints         []string `json:"hints"`
	OSConcept     string   `json:"os_concept"`
	ExperimentLink string  `json:"experiment_link"`
	FurtherReading string  `json:"further_reading,omitempty"`
}

// NarrativeResult is the output of the teaching narrative engine.
type NarrativeResult struct {
	IssueType     string         `json:"issue_type"`
	Severity      string         `json:"severity"`
	StoryTitle    string         `json:"story_title"`
	StoryHTML     string         `json:"story_html"`
	ProgressiveHints []TeachingHint `json:"progressive_hints"`
	FixSuggestion string         `json:"fix_suggestion"`
	OSConcept     string         `json:"os_concept"`
	RelatedPanel  string         `json:"related_panel"`
}

// NewTeachingNarrativeEngine creates a new engine with default templates.
func NewTeachingNarrativeEngine() *TeachingNarrativeEngine {
	return &TeachingNarrativeEngine{
		templates: defaultNarratives(),
	}
}

// BuildNarrative generates a teaching narrative for a detected issue.
func (tne *TeachingNarrativeEngine) BuildNarrative(
	issueType string,
	params map[string]string,
) *NarrativeResult {
	tmpl, ok := tne.templates[issueType]
	if !ok {
		return &NarrativeResult{
			IssueType:  issueType,
			StoryTitle: "未识别的问题",
			StoryHTML:  "请查看观测面板了解更多信息。",
		}
	}

	// Fill template parameters
	setup := tne.fillTemplate(tmpl.Setup, params)
	conflict := tne.fillTemplate(tmpl.Conflict, params)
	reveal := tne.fillTemplate(tmpl.Reveal, params)
	fixStory := tne.fillTemplate(tmpl.FixStory, params)
	lesson := tne.fillTemplate(tmpl.Lesson, params)

	storyHTML := fmt.Sprintf(
		`<div class="teaching-story">
  <h4>📖 %s</h4>
  <div class="setup">%s</div>
  <div class="conflict">%s</div>
  <div class="reveal">💡 %s</div>
  <div class="fix">🔧 %s</div>
  <div class="lesson">📚 %s</div>
</div>`,
		tmpl.StoryTitle, setup, conflict, reveal, fixStory, lesson,
	)

	hints := tne.buildProgressiveHints(issueType, params)

	return &NarrativeResult{
		IssueType:       issueType,
		StoryTitle:      tmpl.StoryTitle,
		StoryHTML:       storyHTML,
		ProgressiveHints: hints,
		FixSuggestion:   fixStory,
		OSConcept:       tne.mapToOSConcept(issueType),
		RelatedPanel:    tne.mapToPanel(issueType),
	}
}

// GenerateFollowupQuestions generates recommended follow-up questions
// based on the detected issue and diagnosis.
func (tne *TeachingNarrativeEngine) GenerateFollowupQuestions(issueType string, osConcept string) []string {
	base := map[string][]string{
		"deadlock": {
			fmt.Sprintf("为什么改变加锁顺序就能避免死锁？"),
			fmt.Sprintf("Coffman 四个条件中，哪些是可以人为打破的？"),
			fmt.Sprintf("除了统一加锁顺序，还有哪些避免死锁的方法？"),
		},
		"memory_leak": {
			fmt.Sprintf("为什么进程退出后操作系统会回收泄漏的内存？"),
			fmt.Sprintf("堆和栈的内存管理有什么区别？"),
			fmt.Sprintf("如何使用 Valgrind 检测内存泄漏？"),
		},
		"race_condition": {
			fmt.Sprintf("Happens-Before 关系是什么？"),
			fmt.Sprintf("互斥锁和读写锁的区别是什么？"),
			fmt.Sprintf("除了加锁，还有哪些线程同步的方法？"),
		},
		"fd_leak": {
			fmt.Sprintf("文件描述符是什么？每个进程有多少个？"),
			fmt.Sprintf("为什么用完文件要 close()？"),
			fmt.Sprintf("ulimit -n 是什么？"),
		},
	}

	if qs, ok := base[issueType]; ok {
		return qs
	}
	return []string{
		fmt.Sprintf("%s 在操作系统中的原理是什么？", osConcept),
		fmt.Sprintf("如何修复这个问题？"),
	}
}

func (tne *TeachingNarrativeEngine) buildProgressiveHints(issueType string,
	params map[string]string) []TeachingHint {
	switch issueType {
	case "deadlock":
		return []TeachingHint{
			{
				Level:     1,
				Hints:     []string{"打开 [eBPF 追踪] → [锁分析] 面板", "观察两个线程各自持有什么锁，又在等待什么锁"},
				OSConcept: "deadlock",
				ExperimentLink: "检查 Coffman 四个条件",
			},
			{
				Level:     2,
				Hints:     []string{"两个线程互相等待对方释放锁——这让你想到 OS 的哪个概念？", "注意加锁的顺序：哪个线程先锁了哪个锁？"},
				OSConcept: "deadlock",
			},
			{
				Level:     3,
				Hints:     []string{"这就是死锁。线程A持有锁1等待锁2，线程B持有锁2等待锁1——形成循环等待。"},
				OSConcept: "deadlock",
				FurtherReading: "Coffman, E.G. (1971) — System Deadlocks",
			},
		}
	case "memory_leak":
		return []TeachingHint{
			{
				Level:     1,
				Hints:     []string{"查看 [内存趋势图]，堆大小有什么变化？", "运行过程中堆是一直增长还是稳定？"},
				OSConcept: "memory_leak",
			},
			{
				Level:     2,
				Hints:     []string{"堆持续增长没有下降——每次 malloc() 都对应用了 free() 吗？"},
				OSConcept: "memory_leak",
			},
			{
				Level:     3,
				Hints:     []string{"每次调用时 malloc() 分配了内存，但从未调用 free()。这导致堆持续增长。"},
				OSConcept: "memory_leak",
				FurtherReading: "动态内存管理是 C 语言的核心挑战——malloc/free 必须配对使用",
			},
		}
	}

	return []TeachingHint{
		{Level: 1, Hints: []string{"查看相关观测面板，寻找异常模式"}},
		{Level: 2, Hints: []string{"这个异常模式与什么 OS 概念相关？"}},
		{Level: 3, Hints: []string{"完整解释请参考 AI 诊断报告"}},
	}
}

// generateHintsL1 generates level-1 observation guidance hints.
func (tne *TeachingNarrativeEngine) generateHintsL1(panel, tab string) []string {
	return []string{
		fmt.Sprintf("在 [%s] 面板中观察数据变化", panel),
		fmt.Sprintf("你注意到什么异常了吗？"),
	}
}

func (tne *TeachingNarrativeEngine) fillTemplate(tmpl string, params map[string]string) string {
	result := tmpl
	for k, v := range params {
		result = strings.ReplaceAll(result, "{"+k+"}", v)
	}
	return result
}

func (tne *TeachingNarrativeEngine) mapToOSConcept(issueType string) string {
	m := map[string]string{
		"deadlock":      "死锁 (Deadlock)",
		"memory_leak":   "内存泄漏 (Memory Leak)",
		"race_condition": "数据竞争 (Data Race)",
		"fd_leak":       "文件描述符泄漏 (FD Leak)",
		"zombie":        "僵尸进程 (Zombie Process)",
		"performance":   "性能瓶颈 (Performance Bottleneck)",
	}
	if v, ok := m[issueType]; ok {
		return v
	}
	return issueType
}

func (tne *TeachingNarrativeEngine) mapToPanel(issueType string) string {
	m := map[string]string{
		"deadlock":      "locks",
		"memory_leak":   "memory_trend",
		"race_condition": "thread_states",
		"fd_leak":       "sandbox_resources",
		"zombie":        "process_graph",
		"performance":   "flamegraph",
	}
	if v, ok := m[issueType]; ok {
		return v
	}
	return "overview"
}

func defaultNarratives() map[string]NarrativeTemplate {
	return map[string]NarrativeTemplate{
		"deadlock": {
			StoryTitle: "两个线程的「互不相让」",
			Setup:      "程序中有 {thread_a} 和 {thread_b} 两个工作线程，它们各自需要两把锁来完成工作。",
			Conflict:   "但是在 T+{time}ms 时，{thread_a} 先锁了 {lock_1} 又想锁 {lock_2}，而 {thread_b} 先锁了 {lock_2} 又想锁 {lock_1}——两个线程都等着对方释放自己需要的锁。",
			Reveal:     "这就是操作系统中的经典问题——死锁 (Deadlock)。四个必要条件全部满足。",
			FixStory:   "修复很简单：让两个线程都按相同顺序加锁——都先锁 {lock_1}，再锁 {lock_2}。这样就不会形成循环等待了。",
			Lesson:     "死锁告诉我们：在并发编程中，资源获取的顺序至关重要。Coffman 在 1971 年提出的四个条件是判断死锁的黄金标准。",
		},
		"memory_leak": {
			StoryTitle: "消失的内存",
			Setup:      "程序开始运行，堆内存从 {start_size} 起步。",
			Conflict:   "每次 {function_name}() 执行时，调用 malloc({alloc_size}) 分配了内存——但从来没有调用 free() 来归还。堆内存从 {start_size} 一路涨到 {end_size}。",
			Reveal:     "这就是内存泄漏 (Memory Leak)。堆像被扎了洞的水桶——水（内存）只进不出。",
			FixStory:   "在 {function_name}() 返回前或在 cleanup() 中添加 free(ptr)。口诀：一次 malloc，一次 free。",
			Lesson:     "动态内存管理是程序员的基本功。在 C 语言中，malloc 和 free 必须配对使用。长期运行的服务中，内存泄漏会最终导致 OOM。",
		},
		"race_condition": {
			StoryTitle: "谁先到谁赢？",
			Setup:      "{var_name} 是一个共享变量，{thread_count} 个线程都能读写它——但没有排队机制。",
			Conflict:   "线程1 读到 {var_name}=5，准备改成 6。就在这时候，线程2 也读到 {var_name}=5，也准备改成 6。结果——{var_name} 只加了 1 而不是 2。",
			Reveal:     "这就是数据竞争 (Data Race)。TSan 的 Happens-Before 分析确认：两个线程之间没有任何同步关系。",
			FixStory:   "使用互斥锁 (pthread_mutex_t) 保护共享变量：lock() → 读写 {var_name} → unlock()。",
			Lesson:     "共享数据的访问必须同步——这是并发编程的第一法则。没有保护的并发访问会产生不可预测的结果。",
		},
		"fd_leak": {
			StoryTitle: "用完了不还的文件",
			Setup:      "每个进程能打开的文件数量是有限的（{fd_limit} 个）。",
			Conflict:   "你的程序打开了 {fd_opened} 个文件——但只关闭了 {fd_closed} 个。每打开一个新文件就消耗一个文件描述符。",
			Reveal:     "这就是文件描述符泄漏 (FD Leak)。就像借了图书馆的书不还——你能借的数量是有限的。",
			FixStory:   "每次 open()/fopen() 后，确保在不再需要时调用 close()/fclose()。可以在函数结尾使用统一的 cleanup 块。",
			Lesson:     "文件描述符是有限的内核资源。每个进程默认只有 1024 个。用完后不归还，进程将无法打开新文件。",
		},
	}
}
