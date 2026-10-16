package evaluator

import "testing"

func TestGetStrategy_Categories(t *testing.T) {
	categories := []string{"process", "thread", "memory", "fs", "scheduler", "deadlock", "unknown"}
	for _, cat := range categories {
		s := GetStrategy(cat)
		if s == nil {
			t.Errorf("GetStrategy(%q) returned nil", cat)
		}
		if s.OutputWeight()+s.StructureWeight()+s.BehaviorWeight() != 1.0 {
			t.Errorf("Strategy %q: weights don't sum to 1.0", cat)
		}
	}
}

func TestThreadStrategy_Flags(t *testing.T) {
	s := GetStrategy("thread")
	flags := s.CompileFlags()
	found := false
	for _, f := range flags {
		if f == "-lpthread" {
			found = true
		}
	}
	if !found {
		t.Error("ThreadStrategy should include -lpthread")
	}
}

func TestProcessStrategy_IncludesGFlag(t *testing.T) {
	s := GetStrategy("process")
	flags := s.CompileFlags()
	foundG := false
	for _, f := range flags {
		if f == "-g" {
			foundG = true
		}
	}
	if !foundG {
		t.Error("ProcessStrategy should include -g flag for source line tracking")
	}
}

func TestAllStrategies_IncludeGFlag(t *testing.T) {
	categories := []string{"process", "thread", "memory", "fs", "scheduler", "deadlock"}
	for _, cat := range categories {
		s := GetStrategy(cat)
		flags := s.CompileFlags()
		foundG := false
		for _, f := range flags {
			if f == "-g" {
				foundG = true
			}
		}
		if !foundG {
			t.Errorf("Strategy %q should include -g flag", cat)
		}
	}
}

func TestStrategy_Levels(t *testing.T) {
	tests := []struct {
		cat   string
		level int
	}{
		{"process", 1},
		{"thread", 2},
		{"memory", 2},
		{"fs", 1},
		{"scheduler", 3},
		{"deadlock", 3},
	}
	for _, tt := range tests {
		s := GetStrategy(tt.cat)
		if s.SandboxLevel() != tt.level {
			t.Errorf("Strategy %q: level = %d, want %d", tt.cat, s.SandboxLevel(), tt.level)
		}
	}
}
