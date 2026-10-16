package sandbox

import "time"

// SandboxLevel defines the security level of a sandbox.
type SandboxLevel int

const (
	LevelStandard SandboxLevel = 1 // Standard: 256MB, 80% CPU
	LevelSecure   SandboxLevel = 2 // Secure: 128MB, 60% CPU
	LevelHardened SandboxLevel = 3 // Hardened: 64MB, 50% CPU
)

// SandboxStatus represents the current state of a sandbox.
type SandboxStatus string

const (
	StatusIdle  SandboxStatus = "idle"
	StatusBusy  SandboxStatus = "busy"
	StatusError SandboxStatus = "error"
)

// SandboxBackend represents the type of sandbox backend.
type SandboxBackend string

const (
	BackendNsjail SandboxBackend = "nsjail" // lightweight namespace-based isolation (default)
	BackendDocker SandboxBackend = "docker" // full Docker container isolation
	BackendLocal  SandboxBackend = "local"  // direct execution (dev only)
)

// SandboxInstance represents a running sandbox.
type SandboxInstance struct {
	ID           string         `json:"id"`
	ContainerID  string         `json:"container_id"`
	Level        SandboxLevel   `json:"level"`
	Backend      SandboxBackend `json:"backend"`
	Status       SandboxStatus  `json:"status"`
	CreatedAt    time.Time      `json:"created_at"`
	DisableTrace bool           `json:"-"`
	HostPID      int            `json:"-"` // host-side PID of nsjail process (eBPF mode)
}

// ExecResult holds the result of executing a program in a sandbox.
type ExecResult struct {
	Stdout      string        `json:"stdout"`
	Stderr      string        `json:"stderr"`
	ExitCode    int           `json:"exit_code"`
	ExecTime    time.Duration `json:"exec_time"`
	TraceFile   string        `json:"trace_file"`
	Killed      bool          `json:"killed"`
	MemoryUsage int64         `json:"memory_usage"`
}

// SandboxConfig holds resource limits for a sandbox level.
type SandboxConfig struct {
	MemoryLimit    int64         `json:"memory_limit"`
	CPUPercent     int           `json:"cpu_percent"`
	PIDLimit       int64         `json:"pid_limit"`
	TimeLimit      time.Duration `json:"time_limit"`
	SeccompProfile string        `json:"seccomp_profile"`
	NsjailConfig   string        `json:"nsjail_config"`
	DockerImage    string        `json:"docker_image"` // Docker image for this sandbox level
}
