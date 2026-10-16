package sandbox

import (
	"testing"
)

func TestGetConfig_Levels(t *testing.T) {
	tests := []struct {
		level    SandboxLevel
		memLimit int64
		cpu      int
		pid      int64
		wantErr  bool
	}{
		{LevelStandard, 256 * 1024 * 1024, 80, 64, false},
		{LevelSecure, 128 * 1024 * 1024, 60, 32, false},
		{LevelHardened, 64 * 1024 * 1024, 50, 8, false},
		{SandboxLevel(99), 0, 0, 0, true},
	}

	for _, tt := range tests {
		cfg, err := GetConfig(tt.level)
		if (err != nil) != tt.wantErr {
			t.Errorf("GetConfig(%d) error = %v, wantErr %v", tt.level, err, tt.wantErr)
			continue
		}
		if !tt.wantErr {
			if cfg.MemoryLimit != tt.memLimit {
				t.Errorf("Level %d: MemoryLimit = %d, want %d", tt.level, cfg.MemoryLimit, tt.memLimit)
			}
			if cfg.CPUPercent != tt.cpu {
				t.Errorf("Level %d: CPUPercent = %d, want %d", tt.level, cfg.CPUPercent, tt.cpu)
			}
			if cfg.PIDLimit != tt.pid {
				t.Errorf("Level %d: PIDLimit = %d, want %d", tt.level, cfg.PIDLimit, tt.pid)
			}
		}
	}
}
