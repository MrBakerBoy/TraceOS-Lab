package services

import (
	"fmt"
	"sync"
	"time"

	"github.com/traceos-lab/core-service/internal/types"
)

// CompositeTrigger implements Datadog Composite Monitors pattern.
// AI diagnosis is triggered when >= 2 independent signals are anomalous.
type SignalCategory string

const (
	SignalSyscallErrors SignalCategory = "syscall_errors"
	SignalCPUSaturation SignalCategory = "cpu_saturation"
	SignalMemGrowth    SignalCategory = "mem_growth"
	SignalLockContention SignalCategory = "lock_contention"
	SignalDeadlock     SignalCategory = "deadlock"
	SignalRaceCondition SignalCategory = "race_condition"
	SignalLeakDetected SignalCategory = "leak_detected"
	SignalFDSaturation SignalCategory = "fd_saturation"
	SignalOOMRisk      SignalCategory = "oom_risk"
	SignalTestFailure  SignalCategory = "test_failure"
	SignalCompileError SignalCategory = "compile_error"
)

type SignalThreshold struct {
	Category    SignalCategory
	Threshold   float64
	Window      time.Duration
	MinSamples  int
	Description string
}

var DefaultThresholds = []SignalThreshold{
	{Category: SignalSyscallErrors, Threshold: 10.0, Window: 30 * time.Second, MinSamples: 5, Description: "系统调用错误率 > 10%"},
	{Category: SignalCPUSaturation, Threshold: 80.0, Window: 10 * time.Second, MinSamples: 3, Description: "CPU 饱和度 > 80%"},
	{Category: SignalMemGrowth, Threshold: 5.0, Window: 30 * time.Second, MinSamples: 3, Description: "内存增长率 > 5 MB/s"},
	{Category: SignalLockContention, Threshold: 10.0, Window: 30 * time.Second, MinSamples: 3, Description: "锁等待时间 > 10ms"},
	{Category: SignalDeadlock, Threshold: 1.0, Window: 0, MinSamples: 1, Description: "检测到死锁"},
	{Category: SignalRaceCondition, Threshold: 1.0, Window: 0, MinSamples: 1, Description: "检测到数据竞争"},
	{Category: SignalLeakDetected, Threshold: 1.0, Window: 0, MinSamples: 1, Description: "检测到内存泄漏"},
	{Category: SignalFDSaturation, Threshold: 0.8, Window: 10 * time.Second, MinSamples: 3, Description: "文件描述符使用率 > 80%"},
	{Category: SignalOOMRisk, Threshold: 0.7, Window: 10 * time.Second, MinSamples: 3, Description: "OOM 风险 > 70%"},
	{Category: SignalTestFailure, Threshold: 1.0, Window: 0, MinSamples: 1, Description: "测试用例未通过"},
	{Category: SignalCompileError, Threshold: 1.0, Window: 0, MinSamples: 1, Description: "编译失败"},
}

type SignalState struct {
	Category     SignalCategory
	CurrentValue float64
	IsAnomalous  bool
	LastUpdated  time.Time
	History      []SignalSample
}

type SignalSample struct {
	Value     float64
	Timestamp time.Time
}

type CompositeResult struct {
	ShouldTrigger bool                         `json:"should_trigger"`
	ActiveSignals []SignalCategory             `json:"active_signals"`
	SignalStates  map[SignalCategory]SignalState `json:"signal_states"`
	TriggerReason string                       `json:"trigger_reason"`
	Confidence    float64                      `json:"confidence"`
	EvaluatedAt   time.Time                    `json:"evaluated_at"`
}

type CompositeTrigger struct {
	mu         sync.RWMutex
	states     map[SignalCategory]*SignalState
	thresholds map[SignalCategory]SignalThreshold
	MinSignals int
}

func NewCompositeTrigger() *CompositeTrigger {
	ct := &CompositeTrigger{
		states:     make(map[SignalCategory]*SignalState),
		thresholds: make(map[SignalCategory]SignalThreshold),
		MinSignals: 2,
	}
	for _, t := range DefaultThresholds {
		ct.thresholds[t.Category] = t
		ct.states[t.Category] = &SignalState{Category: t.Category}
	}
	return ct
}

func (ct *CompositeTrigger) FeedObsContext(ctx *types.ObsContext) *CompositeResult {
	ct.mu.Lock()
	defer ct.mu.Unlock()

	ct.evalSyscallErrors(ctx)
	ct.evalCPUSaturation(ctx)
	ct.evalMemGrowth(ctx)
	ct.evalLockContention(ctx)
	ct.evalDeadlock(ctx)
	ct.evalRaceCondition(ctx)
	ct.evalLeakDetected(ctx)
	ct.evalFDSaturation(ctx)
	ct.evalOOMRisk(ctx)
	ct.evalTestFailure(ctx)
	ct.evalCompileError(ctx)

	return ct.evaluateComposite()
}

func (ct *CompositeTrigger) evalSyscallErrors(ctx *types.ObsContext) {
	state := ct.states[SignalSyscallErrors]
	state.CurrentValue = ctx.REDMetrics.ErrorRate
	ct.checkThreshold(state, SignalSyscallErrors, ctx.REDMetrics.ErrorRate)
}

func (ct *CompositeTrigger) evalCPUSaturation(ctx *types.ObsContext) {
	state := ct.states[SignalCPUSaturation]
	state.CurrentValue = ctx.USEMetrics.CPUSaturation
	ct.checkThreshold(state, SignalCPUSaturation, ctx.USEMetrics.CPUSaturation)
}

func (ct *CompositeTrigger) evalMemGrowth(ctx *types.ObsContext) {
	if len(ctx.MemorySnapshots) < 2 {
		return
	}
	last := ctx.MemorySnapshots[len(ctx.MemorySnapshots)-1]
	prev := ctx.MemorySnapshots[len(ctx.MemorySnapshots)-2]
	rate := float64(last.HeapSize-prev.HeapSize) / last.Timestamp.Sub(prev.Timestamp).Seconds() / (1024 * 1024)

	state := ct.states[SignalMemGrowth]
	state.CurrentValue = rate
	ct.checkThreshold(state, SignalMemGrowth, rate)
}

func (ct *CompositeTrigger) evalLockContention(ctx *types.ObsContext) {
	if len(ctx.LockEvents) == 0 {
		return
	}
	var totalWait int64
	for _, l := range ctx.LockEvents {
		totalWait += l.WaitDurationNs
	}
	avgWaitMs := float64(totalWait) / float64(len(ctx.LockEvents)) / 1e6

	state := ct.states[SignalLockContention]
	state.CurrentValue = avgWaitMs
	ct.checkThreshold(state, SignalLockContention, avgWaitMs)
}

func (ct *CompositeTrigger) evalDeadlock(ctx *types.ObsContext) {
	detected := 0.0
	if ctx.DeadlockEvolution != nil && len(ctx.DeadlockEvolution.Steps) > 0 {
		detected = 1.0
	}
	state := ct.states[SignalDeadlock]
	state.CurrentValue = detected
	ct.checkThreshold(state, SignalDeadlock, detected)
}

func (ct *CompositeTrigger) evalRaceCondition(ctx *types.ObsContext) {
	detected := float64(len(ctx.RaceReports))
	state := ct.states[SignalRaceCondition]
	state.CurrentValue = detected
	ct.checkThreshold(state, SignalRaceCondition, detected)
}

func (ct *CompositeTrigger) evalLeakDetected(ctx *types.ObsContext) {
	detected := float64(len(ctx.LeakReports))
	state := ct.states[SignalLeakDetected]
	state.CurrentValue = detected
	ct.checkThreshold(state, SignalLeakDetected, detected)
}

func (ct *CompositeTrigger) evalFDSaturation(ctx *types.ObsContext) {
	state := ct.states[SignalFDSaturation]
	state.CurrentValue = ctx.USEMetrics.IOUtilization
	ct.checkThreshold(state, SignalFDSaturation, state.CurrentValue)
}

func (ct *CompositeTrigger) evalOOMRisk(ctx *types.ObsContext) {
	if ctx.RiskIndicators == nil {
		return
	}
	state := ct.states[SignalOOMRisk]
	state.CurrentValue = ctx.RiskIndicators.OOMRiskRate
	ct.checkThreshold(state, SignalOOMRisk, ctx.RiskIndicators.OOMRiskRate)
}

func (ct *CompositeTrigger) evalTestFailure(ctx *types.ObsContext) {
	failScore := 0.0
	if ctx.HealthScore.Score < 70 {
		failScore = 1.0
	}
	state := ct.states[SignalTestFailure]
	state.CurrentValue = failScore
	ct.checkThreshold(state, SignalTestFailure, failScore)
}

func (ct *CompositeTrigger) evalCompileError(ctx *types.ObsContext) {
	hasError := 0.0
	for _, a := range ctx.EventAnnotations {
		if a.Type == "compile" && a.Severity == "critical" {
			hasError = 1.0
			break
		}
	}
	state := ct.states[SignalCompileError]
	state.CurrentValue = hasError
	ct.checkThreshold(state, SignalCompileError, hasError)
}

func (ct *CompositeTrigger) checkThreshold(state *SignalState, cat SignalCategory, value float64) {
	threshold, ok := ct.thresholds[cat]
	if !ok {
		return
	}

	state.LastUpdated = time.Now()
	state.History = append(state.History, SignalSample{Value: value, Timestamp: time.Now()})

	if len(state.History) > 100 {
		state.History = state.History[len(state.History)-50:]
	}

	state.IsAnomalous = value >= threshold.Threshold
}

func (ct *CompositeTrigger) evaluateComposite() *CompositeResult {
	now := time.Now()
	result := &CompositeResult{
		SignalStates: make(map[SignalCategory]SignalState),
		EvaluatedAt:  now,
	}

	anomalousCount := 0
	for cat, state := range ct.states {
		result.SignalStates[cat] = *state
		if state.IsAnomalous {
			result.ActiveSignals = append(result.ActiveSignals, cat)
			anomalousCount++
		}
	}

	result.ShouldTrigger = anomalousCount >= ct.MinSignals

	if result.ShouldTrigger {
		if anomalousCount >= ct.MinSignals+2 {
			result.Confidence = 95.0
		} else if anomalousCount >= ct.MinSignals+1 {
			result.Confidence = 85.0
		} else {
			result.Confidence = 70.0
		}

		reasons := make([]string, len(result.ActiveSignals))
		for i, s := range result.ActiveSignals {
			if t, ok := ct.thresholds[s]; ok {
				reasons[i] = t.Description
			}
		}
		result.TriggerReason = fmt.Sprintf("%d 个独立信号异常: %v", anomalousCount, reasons)
	} else if anomalousCount == 1 {
		result.Confidence = 30.0
		result.TriggerReason = "仅 1 个信号异常，不满足复合触发条件 (需要 >=2)"
	} else {
		result.Confidence = 0.0
		result.TriggerReason = "无异常信号"
	}

	return result
}

func (ct *CompositeTrigger) SetThreshold(cat SignalCategory, value float64, window time.Duration) {
	ct.mu.Lock()
	defer ct.mu.Unlock()
	if t, ok := ct.thresholds[cat]; ok {
		t.Threshold = value
		t.Window = window
		ct.thresholds[cat] = t
	}
}

func (ct *CompositeTrigger) SetMinSignals(min int) {
	ct.mu.Lock()
	defer ct.mu.Unlock()
	if min < 1 {
		min = 1
	}
	ct.MinSignals = min
}
