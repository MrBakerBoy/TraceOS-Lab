package sandbox

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"time"
)

// DockerSandboxManager executes binaries inside Docker containers.
// It provides full container-based isolation with standardized environments.
// Each experiment category can use a different Docker image for its toolchain.
type DockerSandboxManager struct {
	mu            sync.Mutex
	nextID        atomic.Int64
	dockerBin     string
	defaultImage  string
	workBase      string
	maxConcurrent int
	semaphore     chan struct{}
}

// NewDockerSandboxManager creates a new Docker-based sandbox manager.
func NewDockerSandboxManager() *DockerSandboxManager {
	dockerBin := os.Getenv("DOCKER_BIN")
	if dockerBin == "" {
		dockerBin = "docker"
	}
	defaultImage := os.Getenv("DOCKER_SANDBOX_IMAGE")
	if defaultImage == "" {
		defaultImage = "traceos-lab-sandbox:latest"
	}
	workBase := os.Getenv("DOCKER_WORK_DIR")
	if workBase == "" {
		workBase = "/tmp/traceos-docker"
	}
	maxConcStr := os.Getenv("DOCKER_MAX_CONCURRENT")
	maxConc := 5
	if v, err := strconv.Atoi(maxConcStr); err == nil && v > 0 && v <= 20 {
		maxConc = v
	}

	m := &DockerSandboxManager{
		dockerBin:     dockerBin,
		defaultImage:  defaultImage,
		workBase:      workBase,
		maxConcurrent: maxConc,
		semaphore:     make(chan struct{}, maxConc),
	}
	_ = os.MkdirAll(m.workBase, 0o755)
	return m
}

// Acquire creates a work directory and registers the sandbox instance.
// Docker containers are created on-demand during Execute, not pre-allocated.
func (m *DockerSandboxManager) Acquire(ctx context.Context, level SandboxLevel) (*SandboxInstance, error) {
	select {
	case m.semaphore <- struct{}{}:
	case <-ctx.Done():
		return nil, ctx.Err()
	}

	m.mu.Lock()
	defer m.mu.Unlock()

	id := fmt.Sprintf("docker-%d-%d", level, m.nextID.Add(1))
	workDir := filepath.Join(m.workBase, id)
	if err := os.MkdirAll(workDir, 0o755); err != nil {
		<-m.semaphore
		return nil, fmt.Errorf("docker: mkdir workdir: %w", err)
	}

	return &SandboxInstance{
		ID:          id,
		ContainerID: id, // will be replaced with actual container ID on Execute
		Level:       level,
		Backend:     BackendDocker,
		Status:      StatusBusy,
		CreatedAt:   time.Now(),
	}, nil
}

// Execute runs a binary inside a Docker container with resource limits and strace.
func (m *DockerSandboxManager) Execute(ctx context.Context, si *SandboxInstance, binary string, stdin []byte, timeout time.Duration) (*ExecResult, error) {
	limits := resourceLimits(si.Level)
	cfg, err := GetConfig(si.Level)
	if err != nil {
		return nil, fmt.Errorf("docker: get config: %w", err)
	}

	image := cfg.DockerImage
	if image == "" {
		image = m.defaultImage
	}

	// Work directory: contains the binary and will receive strace output
	workDir := filepath.Join(m.workBase, si.ID)
	binaryName := filepath.Base(binary)

	// Copy binary into work directory
	binaryDest := filepath.Join(workDir, binaryName)
	if err := copyFile(binary, binaryDest); err != nil {
		return nil, fmt.Errorf("docker: copy binary: %w", err)
	}
	_ = os.Chmod(binaryDest, 0o755)

	tracePath := filepath.Join(workDir, "strace.log")

	// Build docker run command
	// docker run --rm \
	//   --memory=256m --cpus=0.8 --pids-limit=64 \
	//   --network=none \
	//   --read-only --tmpfs /tmp:rw,noexec,nosuid,size=64m \
	//   -v <workDir>:/work:ro \
	//   -v <workDir>/strace-output:/strace:rw \
	//   <image> \
	//   strace -tt -k -o /strace/strace.log /work/<binary>
	containerName := si.ID

	args := []string{
		"run",
		"--rm",
		"--name", containerName,
		"--memory", fmt.Sprintf("%dm", limits.memLimitMB),
		"--cpus", fmt.Sprintf("%.2f", float64(limits.cpuPercent)/100.0),
		"--pids-limit", strconv.Itoa(limits.pidMax),
		"--network", "none",
		"--read-only",
		"--tmpfs", "/tmp:rw,noexec,nosuid,size=64m",
		"--security-opt", "no-new-privileges",
		"-v", fmt.Sprintf("%s:/work:ro", workDir),
	}

	if !si.DisableTrace {
		// Create strace output directory
		straceDir := filepath.Join(workDir, "strace-output")
		os.MkdirAll(straceDir, 0o755)
		args = append(args, "-v", fmt.Sprintf("%s:/strace:rw", straceDir))

		// Run with strace
		args = append(args,
			image,
			"strace", "-f", "-tt", "-T", "-k", "-o", "/strace/strace.log",
			fmt.Sprintf("/work/%s", binaryName),
		)
	} else {
		// Run without strace
		args = append(args,
			image,
			fmt.Sprintf("/work/%s", binaryName),
		)
	}

	timeoutCtx, cancel := context.WithTimeout(ctx, timeout+10*time.Second)
	defer cancel()

	cmd := exec.CommandContext(timeoutCtx, m.dockerBin, args...)
	if len(stdin) > 0 {
		cmd.Stdin = bytes.NewReader(stdin)
	}

	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}

	// Ensure cleanup on timeout
	go func() {
		<-timeoutCtx.Done()
		if timeoutCtx.Err() == context.DeadlineExceeded {
			// Force kill the container
			killCmd := exec.Command(m.dockerBin, "kill", containerName)
			_ = killCmd.Run()
		}
	}()

	start := time.Now()
	err = cmd.Run()
	elapsed := time.Since(start)

	result := &ExecResult{
		Stdout:   stdout.String(),
		Stderr:   stderr.String(),
		ExecTime: elapsed,
	}

	// Try to read strace output into result
	if !si.DisableTrace {
		if traceData, readErr := os.ReadFile(tracePath); readErr == nil {
			result.TraceFile = tracePath
			// If stdout is empty, strace log contains the program's actual stdout
			// (strace writes syscall traces to stderr, program output goes to stdout)
			_ = traceData
		}
	}

	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			result.ExitCode = exitErr.ExitCode()
		} else if timeoutCtx.Err() == context.DeadlineExceeded {
			result.Killed = true
			result.ExitCode = -1
		} else {
			result.ExitCode = 137 // SIGKILL
			result.Killed = true
		}
	}

	// Extract container ID from docker output (last line of stderr for docker run)
	// The actual container ID is in docker's output
	result.MemoryUsage = parseDockerMemoryUsage(stderr.String())

	return result, nil
}

// Release cleans up the sandbox work directory and releases the semaphore slot.
// ExecuteEBPF is not supported in Docker mode — use nsjail for eBPF.
func (m *DockerSandboxManager) ExecuteEBPF(ctx context.Context, si *SandboxInstance, binary string, stdin []byte, timeout time.Duration) (*ExecResult, error) {
	return nil, fmt.Errorf("ExecuteEBPF not supported with Docker backend")
}

// WaitEBPF is not supported in Docker mode.
func (m *DockerSandboxManager) WaitEBPF(si *SandboxInstance) (*ExecResult, error) {
	return nil, fmt.Errorf("WaitEBPF not supported with Docker backend")
}

func (m *DockerSandboxManager) Release(si *SandboxInstance) error {
	workDir := filepath.Join(m.workBase, si.ID)

	// Best-effort cleanup: remove any lingering container
	cleanupCmd := exec.Command(m.dockerBin, "rm", "-f", si.ID)
	_ = cleanupCmd.Run()

	// Clean up work directory in background
	go func(dir string) { _ = os.RemoveAll(dir) }(workDir)

	<-m.semaphore
	return nil
}

// Shutdown cleans up all sandbox resources.
func (m *DockerSandboxManager) Shutdown() error {
	// Clean up all work directories
	entries, err := os.ReadDir(m.workBase)
	if err != nil {
		return nil
	}
	for _, entry := range entries {
		if entry.IsDir() && strings.HasPrefix(entry.Name(), "docker-") {
			containerID := entry.Name()
			cleanupCmd := exec.Command(m.dockerBin, "rm", "-f", containerID)
			_ = cleanupCmd.Run()
			_ = os.RemoveAll(filepath.Join(m.workBase, entry.Name()))
		}
	}
	return nil
}

// ── Helpers ────────────────────────────────────────────────────────────

func copyFile(src, dst string) error {
	data, err := os.ReadFile(src)
	if err != nil {
		return err
	}
	return os.WriteFile(dst, data, 0o755)
}

func parseDockerMemoryUsage(stderr string) int64 {
	// Docker outputs container resource usage via docker stats or inspect
	// For now, parse any memory-related lines
	for _, line := range strings.Split(stderr, "\n") {
		if strings.Contains(line, "memory") || strings.Contains(line, "max_usage") {
			fields := strings.Fields(line)
			for _, f := range fields {
				if v, err := strconv.ParseInt(f, 10, 64); err == nil && v > 1024 {
					return v
				}
			}
		}
	}
	return 0
}
