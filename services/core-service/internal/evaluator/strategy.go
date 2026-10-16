package evaluator

// ExperimentStrategy defines differentiated behavior per experiment type.
type ExperimentStrategy interface {
	SeccompProfile() string
	SandboxLevel() int
	SandboxBackend() string
	MemoryLimit() int64
	TimeLimit() int
	CompileFlags() []string
	CompileFlagsFor(language string) []string
	OutputWeight() float64
	StructureWeight() float64
	BehaviorWeight() float64
	CompareMode() string
	RerunCount() int
	DisableTrace() bool
	ExitCodeRequired() int
	// ExpectedSyscalls returns syscalls that must appear in the program's trace.
	ExpectedSyscalls() []string
	// ForbiddenSyscalls returns syscalls that must NOT appear.
	ForbiddenSyscalls() []string
}

func compileFlagsForLang(cFlags []string, language string) []string {
	switch language {
	case "c", "cpp", "c++":
		return cFlags
	default:
		return nil
	}
}

func ensureGFlag(flags []string) []string {
	for _, f := range flags {
		if f == "-g" {
			return flags
		}
	}
	return append(flags, "-g")
}

type gFlagStrategy struct {
	ExperimentStrategy
}

func (s *gFlagStrategy) CompileFlags() []string {
	return ensureGFlag(s.ExperimentStrategy.CompileFlags())
}

func (s *gFlagStrategy) CompileFlagsFor(language string) []string {
	flags := s.ExperimentStrategy.CompileFlagsFor(language)
	if flags != nil {
		return ensureGFlag(flags)
	}
	return flags
}

func (s *gFlagStrategy) ExpectedSyscalls() []string {
	return s.ExperimentStrategy.ExpectedSyscalls()
}

func (s *gFlagStrategy) ForbiddenSyscalls() []string {
	return s.ExperimentStrategy.ForbiddenSyscalls()
}

func GetStrategy(category string) ExperimentStrategy {
	var base ExperimentStrategy
	switch category {
	case "process":
		base = &ProcessStrategy{}
	case "thread":
		base = &ThreadStrategy{}
	case "memory":
		base = &MemoryStrategy{}
	case "fs":
		base = &FileStrategy{}
	case "scheduler":
		base = &SchedulerStrategy{}
	case "deadlock":
		base = &DeadlockStrategy{}
	default:
		base = &ProcessStrategy{}
	}
	return &gFlagStrategy{base}
}

// ── Process ──
type ProcessStrategy struct{}

func (s *ProcessStrategy) SeccompProfile() string          { return "process-lab" }
func (s *ProcessStrategy) SandboxLevel() int               { return 1 }
func (s *ProcessStrategy) SandboxBackend() string          { return "nsjail" }
func (s *ProcessStrategy) MemoryLimit() int64              { return 256 * 1024 * 1024 }
func (s *ProcessStrategy) TimeLimit() int                  { return 30 }
func (s *ProcessStrategy) CompileFlags() []string          { return nil }
func (s *ProcessStrategy) CompileFlagsFor(lang string) []string { return compileFlagsForLang(s.CompileFlags(), lang) }
func (s *ProcessStrategy) OutputWeight() float64           { return 0.50 }
func (s *ProcessStrategy) StructureWeight() float64        { return 0.25 }
func (s *ProcessStrategy) BehaviorWeight() float64         { return 0.25 }
func (s *ProcessStrategy) CompareMode() string             { return "normalized_contains" }
func (s *ProcessStrategy) RerunCount() int                 { return 1 }
func (s *ProcessStrategy) DisableTrace() bool              { return false }
func (s *ProcessStrategy) ExitCodeRequired() int           { return 0 }
func (s *ProcessStrategy) ExpectedSyscalls() []string      { return []string{"clone", "wait4", "write"} }
func (s *ProcessStrategy) ForbiddenSyscalls() []string     { return []string{"system"} }

// ── Thread ──
type ThreadStrategy struct{}

func (s *ThreadStrategy) SeccompProfile() string          { return "thread-lab" }
func (s *ThreadStrategy) SandboxLevel() int               { return 2 }
func (s *ThreadStrategy) SandboxBackend() string          { return "nsjail" }
func (s *ThreadStrategy) MemoryLimit() int64               { return 128 * 1024 * 1024 }
func (s *ThreadStrategy) TimeLimit() int                   { return 30 }
func (s *ThreadStrategy) CompileFlags() []string           { return []string{"-lpthread"} }
func (s *ThreadStrategy) CompileFlagsFor(lang string) []string { return compileFlagsForLang(s.CompileFlags(), lang) }
func (s *ThreadStrategy) OutputWeight() float64            { return 0.50 }
func (s *ThreadStrategy) StructureWeight() float64         { return 0.25 }
func (s *ThreadStrategy) BehaviorWeight() float64          { return 0.25 }
func (s *ThreadStrategy) CompareMode() string              { return "normalized_contains" }
func (s *ThreadStrategy) RerunCount() int                  { return 1 }
func (s *ThreadStrategy) DisableTrace() bool               { return false }
func (s *ThreadStrategy) ExitCodeRequired() int            { return 0 }
func (s *ThreadStrategy) ExpectedSyscalls() []string       { return []string{"clone", "futex", "write"} }
func (s *ThreadStrategy) ForbiddenSyscalls() []string      { return nil }

// ── Memory ──
type MemoryStrategy struct{}

func (s *MemoryStrategy) SeccompProfile() string          { return "memory-lab" }
func (s *MemoryStrategy) SandboxLevel() int               { return 2 }
func (s *MemoryStrategy) SandboxBackend() string          { return "nsjail" }
func (s *MemoryStrategy) MemoryLimit() int64               { return 512 * 1024 * 1024 }
func (s *MemoryStrategy) TimeLimit() int                   { return 120 }
func (s *MemoryStrategy) CompileFlags() []string           { return nil }
func (s *MemoryStrategy) CompileFlagsFor(lang string) []string { return compileFlagsForLang(s.CompileFlags(), lang) }
func (s *MemoryStrategy) OutputWeight() float64            { return 0.50 }
func (s *MemoryStrategy) StructureWeight() float64         { return 0.25 }
func (s *MemoryStrategy) BehaviorWeight() float64          { return 0.25 }
func (s *MemoryStrategy) CompareMode() string              { return "normalized_contains" }
func (s *MemoryStrategy) RerunCount() int                  { return 1 }
func (s *MemoryStrategy) DisableTrace() bool               { return false }
func (s *MemoryStrategy) ExitCodeRequired() int            { return 0 }
func (s *MemoryStrategy) ExpectedSyscalls() []string       { return []string{"brk", "munmap", "write"} }
func (s *MemoryStrategy) ForbiddenSyscalls() []string      { return nil }

// ── File System ──
type FileStrategy struct{}

func (s *FileStrategy) SeccompProfile() string            { return "fs-lab" }
func (s *FileStrategy) SandboxLevel() int                 { return 1 }
func (s *FileStrategy) SandboxBackend() string            { return "docker" }
func (s *FileStrategy) MemoryLimit() int64                 { return 256 * 1024 * 1024 }
func (s *FileStrategy) TimeLimit() int                     { return 60 }
func (s *FileStrategy) CompileFlags() []string             { return nil }
func (s *FileStrategy) CompileFlagsFor(lang string) []string { return compileFlagsForLang(s.CompileFlags(), lang) }
func (s *FileStrategy) OutputWeight() float64              { return 0.50 }
func (s *FileStrategy) StructureWeight() float64           { return 0.25 }
func (s *FileStrategy) BehaviorWeight() float64            { return 0.25 }
func (s *FileStrategy) CompareMode() string                { return "normalized_contains" }
func (s *FileStrategy) RerunCount() int                    { return 1 }
func (s *FileStrategy) DisableTrace() bool                 { return true }
func (s *FileStrategy) ExitCodeRequired() int             { return 0 }
func (s *FileStrategy) ExpectedSyscalls() []string         { return []string{"openat", "read", "write", "close"} }
func (s *FileStrategy) ForbiddenSyscalls() []string        { return nil }

// ── Scheduler ──
type SchedulerStrategy struct{}

func (s *SchedulerStrategy) SeccompProfile() string       { return "scheduler-lab" }
func (s *SchedulerStrategy) SandboxLevel() int            { return 3 }
func (s *SchedulerStrategy) SandboxBackend() string       { return "nsjail" }
func (s *SchedulerStrategy) MemoryLimit() int64            { return 64 * 1024 * 1024 }
func (s *SchedulerStrategy) TimeLimit() int                { return 60 }
func (s *SchedulerStrategy) CompileFlags() []string        { return []string{"-lm"} }
func (s *SchedulerStrategy) CompileFlagsFor(lang string) []string { return compileFlagsForLang(s.CompileFlags(), lang) }
func (s *SchedulerStrategy) OutputWeight() float64         { return 0.50 }
func (s *SchedulerStrategy) StructureWeight() float64      { return 0.30 }
func (s *SchedulerStrategy) BehaviorWeight() float64       { return 0.20 }
func (s *SchedulerStrategy) CompareMode() string           { return "normalized_contains" }
func (s *SchedulerStrategy) RerunCount() int               { return 1 }
func (s *SchedulerStrategy) DisableTrace() bool            { return false }
func (s *SchedulerStrategy) ExitCodeRequired() int        { return 0 }
func (s *SchedulerStrategy) ExpectedSyscalls() []string    { return []string{"write"} }
func (s *SchedulerStrategy) ForbiddenSyscalls() []string   { return []string{"system", "execve"} }

// ── Deadlock ──
type DeadlockStrategy struct{}

func (s *DeadlockStrategy) SeccompProfile() string         { return "deadlock-lab" }
func (s *DeadlockStrategy) SandboxLevel() int              { return 3 }
func (s *DeadlockStrategy) SandboxBackend() string         { return "nsjail" }
func (s *DeadlockStrategy) MemoryLimit() int64              { return 64 * 1024 * 1024 }
func (s *DeadlockStrategy) TimeLimit() int                  { return 60 }
func (s *DeadlockStrategy) CompileFlags() []string          { return []string{"-lpthread"} }
func (s *DeadlockStrategy) CompileFlagsFor(lang string) []string { return compileFlagsForLang(s.CompileFlags(), lang) }
func (s *DeadlockStrategy) OutputWeight() float64           { return 0.50 }
func (s *DeadlockStrategy) StructureWeight() float64        { return 0.25 }
func (s *DeadlockStrategy) BehaviorWeight() float64         { return 0.25 }
func (s *DeadlockStrategy) CompareMode() string             { return "normalized_contains" }
func (s *DeadlockStrategy) RerunCount() int                 { return 1 }
func (s *DeadlockStrategy) DisableTrace() bool              { return false }
func (s *DeadlockStrategy) ExitCodeRequired() int           { return 0 }
func (s *DeadlockStrategy) ExpectedSyscalls() []string      { return []string{"clone", "futex", "write"} }
func (s *DeadlockStrategy) ForbiddenSyscalls() []string     { return nil }
