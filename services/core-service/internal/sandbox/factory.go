package sandbox

import (
	"fmt"
	"os"
)

// SandboxFactory creates the appropriate SandboxManager based on configuration.
// It supports three modes:
//   - "nsjail": lightweight namespace-based isolation (default, best for high-throughput)
//   - "docker": full Docker container isolation (best for environment standardization)
//   - "local": direct execution without isolation (development only)
//   - "auto": select backend per experiment based on strategy hints
type SandboxFactory struct {
	defaultBackend SandboxBackend
	dockerMgr      *DockerSandboxManager
	nsjailMgr      *NsjailSandboxManager
	localMgr       *LocalSandboxManager
}

// NewSandboxFactory creates a factory. Caller should defer Shutdown() on the
// returned Pool (which wraps the primary manager for backward compatibility).
func NewSandboxFactory() *SandboxFactory {
	backend := SandboxBackend(os.Getenv("SANDBOX_BACKEND"))
	if backend == "" {
		backend = BackendNsjail // default: nsjail for best strace control
	}

	f := &SandboxFactory{
		defaultBackend: backend,
	}

	switch backend {
	case BackendDocker:
		f.dockerMgr = NewDockerSandboxManager()
	case BackendLocal:
		f.localMgr = NewLocalSandboxManager()
	default:
		f.nsjailMgr = NewNsjailSandboxManager()
	}

	return f
}

// GetManager returns the SandboxManager for a given backend type.
// If backend is empty, uses the factory's default.
func (f *SandboxFactory) GetManager(backend SandboxBackend) (SandboxManager, error) {
	if backend == "" {
		backend = f.defaultBackend
	}

	switch backend {
	case BackendDocker:
		if f.dockerMgr == nil {
			f.dockerMgr = NewDockerSandboxManager()
		}
		return f.dockerMgr, nil
	case BackendLocal:
		if f.localMgr == nil {
			f.localMgr = NewLocalSandboxManager()
		}
		return f.localMgr, nil
	case BackendNsjail:
		if f.nsjailMgr == nil {
			f.nsjailMgr = NewNsjailSandboxManager()
		}
		return f.nsjailMgr, nil
	default:
		return nil, fmt.Errorf("unknown sandbox backend: %s", backend)
	}
}

// GetDefaultManager returns the default sandbox manager.
func (f *SandboxFactory) GetDefaultManager() SandboxManager {
	mgr, _ := f.GetManager(f.defaultBackend)
	return mgr
}

// DefaultBackend returns the factory's default backend type.
func (f *SandboxFactory) DefaultBackend() SandboxBackend {
	return f.defaultBackend
}

// Shutdown cleans up all sandbox backends.
func (f *SandboxFactory) Shutdown() error {
	var errs []error
	if f.dockerMgr != nil {
		if err := f.dockerMgr.Shutdown(); err != nil {
			errs = append(errs, err)
		}
	}
	if f.nsjailMgr != nil {
		if err := f.nsjailMgr.Shutdown(); err != nil {
			errs = append(errs, err)
		}
	}
	if f.localMgr != nil {
		if err := f.localMgr.Shutdown(); err != nil {
			errs = append(errs, err)
		}
	}
	if len(errs) > 0 {
		return fmt.Errorf("shutdown errors: %v", errs)
	}
	return nil
}
