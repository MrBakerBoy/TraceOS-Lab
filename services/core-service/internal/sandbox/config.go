package sandbox

import (
	"fmt"
	"time"
)

// GetConfig returns the sandbox configuration for a given level.
func GetConfig(level SandboxLevel) (SandboxConfig, error) {
	switch level {
	case LevelStandard:
		return SandboxConfig{
			MemoryLimit:    256 * 1024 * 1024,
			CPUPercent:     80,
			PIDLimit:       64,
			TimeLimit:      300 * time.Second,
			SeccompProfile: "sandbox/seccomp-profiles/process-lab.json",
			NsjailConfig:   "sandbox/nsjail-configs/level1-standard.pb",
			DockerImage:    "traceos-lab-sandbox:standard",
		}, nil
	case LevelSecure:
		return SandboxConfig{
			MemoryLimit:    128 * 1024 * 1024,
			CPUPercent:     60,
			PIDLimit:       32,
			TimeLimit:      300 * time.Second,
			SeccompProfile: "sandbox/seccomp-profiles/thread-lab.json",
			NsjailConfig:   "sandbox/nsjail-configs/level2-secure.pb",
			DockerImage:    "traceos-lab-sandbox:secure",
		}, nil
	case LevelHardened:
		return SandboxConfig{
			MemoryLimit:    64 * 1024 * 1024,
			CPUPercent:     50,
			PIDLimit:       8,
			TimeLimit:      180 * time.Second,
			SeccompProfile: "sandbox/seccomp-profiles/deadlock-lab.json",
			NsjailConfig:   "sandbox/nsjail-configs/level3-hardened.pb",
			DockerImage:    "traceos-lab-sandbox:secure",
		}, nil
	default:
		return SandboxConfig{}, fmt.Errorf("invalid sandbox level: %d", level)
	}
}
