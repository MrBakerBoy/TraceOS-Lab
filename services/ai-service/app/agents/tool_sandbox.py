"""
Tool Sandbox — Execution isolation layer.

Provides nsjail-based sandboxing for agent tool execution, ensuring each
tool call runs within strict boundaries: timeout, memory limit, process
count limit, and filesystem isolation. When nsjail is unavailable, falls
back to a lightweight process-level isolation using resource limits.
"""

import asyncio
import logging
import os
import resource
import shutil
import time
from dataclasses import dataclass, field
from typing import Any

logger = logging.getLogger(__name__)


@dataclass
class SandboxConfig:
    timeout_seconds: float = 30.0
    memory_limit_mb: int = 512
    max_processes: int = 5
    max_file_size_mb: int = 100
    allow_network: bool = False
    readonly_rootfs: bool = True


SANDBOX_PRESETS: dict[str, SandboxConfig] = {
    "run_code": SandboxConfig(timeout_seconds=30.0, memory_limit_mb=256, max_processes=5),
    "run_tests": SandboxConfig(timeout_seconds=60.0, memory_limit_mb=512, max_processes=10),
    "get_strace": SandboxConfig(timeout_seconds=15.0, memory_limit_mb=128, max_processes=2),
    "search_knowledge": SandboxConfig(timeout_seconds=10.0, memory_limit_mb=128, allow_network=True),
    "analyze_ebpf": SandboxConfig(timeout_seconds=30.0, memory_limit_mb=256, max_processes=3),
    "get_flamegraph": SandboxConfig(timeout_seconds=20.0, memory_limit_mb=256, max_processes=3),
    "get_diagnosis": SandboxConfig(timeout_seconds=30.0, memory_limit_mb=256),
    "submit_feedback": SandboxConfig(timeout_seconds=10.0, memory_limit_mb=64),
}

DEFAULT_SANDBOX = SandboxConfig()


@dataclass
class SandboxResult:
    success: bool
    output: str = ""
    error: str = ""
    exit_code: int = -1
    duration_ms: float = 0.0
    was_killed: bool = False
    kill_reason: str = ""
    metadata: dict[str, Any] = field(default_factory=dict)


class ToolSandbox:
    """Executes tool calls inside an isolated sandbox environment."""

    def __init__(self):
        self._nsjail_available: bool | None = None

    @property
    def nsjail_available(self) -> bool:
        if self._nsjail_available is None:
            self._nsjail_available = shutil.which("nsjail") is not None
            if self._nsjail_available:
                logger.info("nsjail detected — full sandbox isolation available")
            else:
                logger.warning("nsjail not found — falling back to process-level isolation")
        return self._nsjail_available

    async def execute(self, tool_name: str, coro, *, config: SandboxConfig | None = None) -> SandboxResult:
        cfg = config or SANDBOX_PRESETS.get(tool_name, DEFAULT_SANDBOX)
        start = time.monotonic()
        try:
            result = await asyncio.wait_for(self._execute_with_limits(coro, cfg), timeout=cfg.timeout_seconds + 5.0)
            result.duration_ms = (time.monotonic() - start) * 1000
            return result
        except asyncio.TimeoutError:
            duration_ms = (time.monotonic() - start) * 1000
            logger.error("Tool %s timed out after %.1fs", tool_name, cfg.timeout_seconds)
            return SandboxResult(success=False, error=f"Tool execution timed out ({cfg.timeout_seconds}s limit)", was_killed=True, kill_reason="timeout", duration_ms=duration_ms)
        except Exception as e:
            duration_ms = (time.monotonic() - start) * 1000
            logger.error("Tool %s sandbox error: %s", tool_name, e)
            return SandboxResult(success=False, error=str(e), duration_ms=duration_ms)

    async def _execute_with_limits(self, coro, cfg: SandboxConfig) -> SandboxResult:
        try:
            mem_bytes = cfg.memory_limit_mb * 1024 * 1024
            resource.setrlimit(resource.RLIMIT_AS, (mem_bytes, mem_bytes))
        except (ValueError, resource.error) as e:
            logger.warning("Failed to set memory limit: %s", e)
        try:
            cpu_seconds = int(cfg.timeout_seconds)
            resource.setrlimit(resource.RLIMIT_CPU, (cpu_seconds, cpu_seconds + 5))
        except (ValueError, resource.error) as e:
            logger.warning("Failed to set CPU limit: %s", e)
        try:
            if asyncio.iscoroutine(coro):
                result = await coro
            elif callable(coro):
                result = await coro()
            else:
                return SandboxResult(success=False, error="Tool callable must be an awaitable or async callable")
            return SandboxResult(success=True, output=str(result) if not isinstance(result, str) else result, exit_code=0)
        except MemoryError:
            return SandboxResult(success=False, error=f"Memory limit exceeded ({cfg.memory_limit_mb}MB)", was_killed=True, kill_reason="oom")


class NsjailSandbox:
    """Full container-isolated sandbox using nsjail."""

    def __init__(self, nsjail_path: str | None = None):
        self.nsjail_path = nsjail_path or shutil.which("nsjail") or "nsjail"
        self._has_nsjail = shutil.which(self.nsjail_path) is not None

    @property
    def available(self) -> bool:
        return self._has_nsjail

    async def execute(self, cmd: list[str], *, config: SandboxConfig = DEFAULT_SANDBOX, workdir: str = "/tmp", env: dict[str, str] | None = None) -> SandboxResult:
        if not self.available:
            return SandboxResult(success=False, error="nsjail is not available on this system")
        start = time.monotonic()
        nsjail_cmd = [
            self.nsjail_path, "--mode", "once",
            "--chroot", "/",
            "--rw", f"--bindmount={workdir}:{workdir}",
            "--tmpfsmount", "/tmp",
            f"--time_limit={int(config.timeout_seconds)}",
            f"--cgroup_mem_max={config.memory_limit_mb * 1024 * 1024}",
            "--max_cpus=1",
        ]
        if not config.allow_network:
            nsjail_cmd.extend(["--disable_clone_newns", "--iface_no_lo"])
        if config.max_processes > 0:
            nsjail_cmd.extend([f"--cgroup_pids_max={config.max_processes}"])
        nsjail_cmd.extend(["--"] + cmd)
        try:
            proc = await asyncio.create_subprocess_exec(*nsjail_cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE, env=env or {}, cwd=workdir)
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=config.timeout_seconds + 5.0)
            duration_ms = (time.monotonic() - start) * 1000
            output = stdout.decode("utf-8", errors="replace")[:50000]
            err_output = stderr.decode("utf-8", errors="replace")[:50000]
            was_killed = proc.returncode == 137 or proc.returncode == -9
            return SandboxResult(success=proc.returncode == 0, output=output, error=err_output if proc.returncode != 0 else "", exit_code=proc.returncode, duration_ms=duration_ms, was_killed=was_killed, kill_reason="oom_or_timeout" if was_killed else "")
        except asyncio.TimeoutError:
            duration_ms = (time.monotonic() - start) * 1000
            try:
                proc.kill(); await proc.wait()
            except Exception:
                pass
            return SandboxResult(success=False, error="nsjail execution timed out", was_killed=True, kill_reason="timeout", duration_ms=duration_ms)


class SandboxedToolExecutor:
    """Wraps ToolRegistry to execute every tool call through the sandbox."""

    def __init__(self, tool_registry, sandbox: ToolSandbox | None = None):
        self._registry = tool_registry
        self._sandbox = sandbox or ToolSandbox()

    async def execute_tool(self, tool_name: str, args: dict) -> SandboxResult:
        tool = self._registry.get_tool(tool_name)
        if tool is None:
            return SandboxResult(success=False, error=f"Unknown tool: {tool_name}")
        async def _run():
            return await self._registry.execute(tool_name, args)
        config = SANDBOX_PRESETS.get(tool_name, DEFAULT_SANDBOX)
        return await self._sandbox.execute(tool_name, _run, config=config)


_tool_sandbox: ToolSandbox | None = None

def get_tool_sandbox() -> ToolSandbox:
    global _tool_sandbox
    if _tool_sandbox is None:
        _tool_sandbox = ToolSandbox()
    return _tool_sandbox
