package model

// MsgTypePerfMetrics is the WebSocket message type for live performance metrics
// pushed during an evaluation run.
const MsgTypePerfMetrics = "perf_metrics"

// PerfMetrics holds the computed, rate-based performance metrics for one
// sampling interval of a sandboxed evaluation process. It is the "data"
// block of the perf_metrics WebSocket message.
//
// Field names follow the JSON contract expected by the frontend:
//
//	{
//	  "type": "perf_metrics",
//	  "submission_id": "<uuid>",
//	  "data": { ...PerfMetrics... }
//	}
type PerfMetrics struct {
	// Timestamp is the unix time (seconds, fractional) of the sample.
	Timestamp float64 
	// CPUPercent is the CPU utilisation of the monitored process group over
	// the interval, expressed as a percentage of one logical CPU.
	CPUPercent float64 
	// MemoryPercent is VmRSS of the process group as a percentage of total
	// system memory.
	MemoryPercent float64 
	// CtxSwitchesPerSec is the rate of context switches (voluntary +
	// nonvoluntary) across the interval.
	CtxSwitchesPerSec float64 
	// PageFaultsPerSec is the rate of (minor + major) page faults across
	// the interval.
	PageFaultsPerSec float64 
	// DiskIOPS is the rate of disk read+write bytes... note: derived from
	// /proc/<pid>/io cumulative byte counters, expressed as total I/O
	// operations per second (reads + writes).
	DiskIOPS float64 
	// NetworkRxBytes is the rate of received bytes per second across the
	// interval (summed over non-loopback interfaces).
	NetworkRxBytes float64 
	// NetworkTxBytes is the rate of transmitted bytes per second across
	// the interval (summed over non-loopback interfaces).
	NetworkTxBytes float64 
}
