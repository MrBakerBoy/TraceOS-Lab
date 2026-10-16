package evaluator

import (
	"encoding/json"

	"github.com/traceos-lab/core-service/internal/nats"
	"github.com/traceos-lab/core-service/internal/types"
)

// BuildEBPFMetrics deterministically extracts an AI-friendly resource summary
// from the strace analysis and obs_context. It never invokes an LLM and never
// produces a score — it only restates observation facts for the AI diagnosis
// layer to translate into teaching suggestions.
func BuildEBPFMetrics(summary *nats.StraceSummaryData, obsCtx *types.ObsContext) *nats.EBPFMetricsData {
	if summary == nil {
		return nil
	}

	m := &nats.EBPFMetricsData{
		Syscall: nats.SyscallMetricsData{
			Stats: map[string]int{
				"total":  summary.TotalSyscalls,
				"errors": summary.ErrorSyscalls,
				"unique": summary.UniqueSyscalls,
			},
			Errors: summary.TopErrors,
		},
	}

	if summary.FDOpenClose != nil {
		if summary.FDOpenClose.HasLeak {
			m.Resource.FdLeak = summary.FDOpenClose.Leaked
		}
	}
	if summary.MemoryOps != nil {
		m.Resource.MemoryImbalance = max(0, summary.MemoryOps.AllocCalls-summary.MemoryOps.FreeCalls)
	}
	if summary.ProcessOps != nil {
		m.Resource.Zombie = max(0, summary.ProcessOps.ForkCalls-summary.ProcessOps.WaitCalls)
	}
	// Deadlock requires lock/wait-for-cycle events, which are not yet wired
	// into the evaluation pipeline. It stays false rather than being guessed.
	m.Resource.Deadlock = false

	if obsCtx != nil && obsCtx.ProcessGraph != nil {
		pg := obsCtx.ProcessGraph
		m.ProcessThread.ThreadCount = pg.Metadata.TotalThreads

		graph := map[string]any{
			"total_processes": pg.Metadata.TotalProcesses,
			"total_threads":   pg.Metadata.TotalThreads,
			"total_ipc":       pg.Metadata.TotalIPC,
		}
		if len(pg.Edges) > 0 {
			edges := make([]map[string]int, 0, len(pg.Edges))
			for _, e := range pg.Edges {
				edges = append(edges, map[string]int{"source": e.Source, "target": e.Target})
			}
			graph["fork_edges"] = edges
		}
		if b, err := json.Marshal(graph); err == nil {
			m.ProcessThread.Graph = b
		}
	}

	return m
}