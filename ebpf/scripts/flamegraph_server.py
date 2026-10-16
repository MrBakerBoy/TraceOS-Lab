#!/usr/bin/env python3
"""
TraceOS Lab - Flame Graph Generation Server
宿主机端火焰图生成 HTTP 服务

用法:
  cd /root/traceos-lab
  nohup python3 ebpf/scripts/flamegraph_server.py --port 8765 &

API:
  POST /generate  {"code": "...", "language": "c|cpp", "compile_flags": [...], "duration": 10}
  GET  /health
"""

import http.server
import json
import os
import subprocess
import sys
import tempfile
import time
import argparse
import shutil
from pathlib import Path

BASE_DIR = Path("/root/traceos-lab")
EBPF_DIR = BASE_DIR / "ebpf"
SCRIPTS_DIR = EBPF_DIR / "scripts"
TOOLS_DIR = EBPF_DIR / "tools" / "FlameGraph"
OUTPUT_DIR = EBPF_DIR / "output"

FLAMEGRAPH_PL = TOOLS_DIR / "flamegraph.pl"
STACKCOLLAPSE_PERF = TOOLS_DIR / "stackcollapse-perf.pl"
STACKCOLLAPSE_BPFTRACE = TOOLS_DIR / "stackcollapse-bpftrace.pl"


class FlameGraphHandler(http.server.BaseHTTPRequestHandler):
    """HTTP request handler for flame graph generation."""

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        if self.path == "/health":
            self._respond_json({"status": "healthy", "service": "flamegraph-server"})
        elif self.path == "/ping":
            self._respond_json({"pong": True, "bpftrace": shutil.which("bpftrace") is not None})
        else:
            self.send_error(404)

    def do_POST(self):
        if self.path == "/generate":
            self._handle_generate()
        else:
            self.send_error(404)

    def _handle_generate(self):
        try:
            length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(length)
            req = json.loads(body)

            code = req.get("code", "")
            language = req.get("language", "c")
            compile_flags = req.get("compile_flags") or []
            duration = min(req.get("duration", 10), 30)

            if not code.strip():
                self._respond_json({"error": "empty code"}, 400)
                return

            result = self._generate_flamegraph(code, language, compile_flags, duration)
            self._respond_json(result)

        except Exception as e:
            self._respond_json({"error": str(e)}, 500)

    def _generate_flamegraph(self, code, language, compile_flags, duration):
        work_dir = tempfile.mkdtemp(prefix="traceos_fg_")
        src_ext = ".cpp" if language == "cpp" else ".c"
        src_path = os.path.join(work_dir, f"student{src_ext}")
        bin_path = os.path.join(work_dir, "student_bin")
        user_svg = os.path.join(work_dir, "flamegraph_user.svg")
        kernel_svg = os.path.join(work_dir, "flamegraph_kernel.svg")

        try:
            # 1. Write source code
            with open(src_path, "w") as f:
                f.write(code)

            # 2. Compile
            compiler = "g++" if language == "cpp" else "gcc"
            cmd = [compiler, "-o", bin_path, src_path] + compile_flags
            proc = subprocess.run(cmd, capture_output=True, text=True, timeout=30, cwd=work_dir)
            if proc.returncode != 0:
                return {
                    "error": "compilation_failed",
                    "compile_error": proc.stderr[:2000],
                    "compile_output": proc.stdout[:1000]
                }

                        # 3. Profile with perf record
            # Wrap binary in a loop so short programs still produce enough samples
            wrapper = os.path.join(work_dir, "run.sh")
            with open(wrapper, "w") as wf:
                wf.write("#!/bin/sh\nfor i in $(seq 1 500); do\n  " + bin_path + " 2>/dev/null\n  sleep 0.001 2>/dev/null || true\ndone\n")
            os.chmod(wrapper, 0o755)

            # Run wrapper in background, perf records for fixed duration
            bin_proc = subprocess.Popen(
                [wrapper],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                cwd=work_dir
            )
            perf_data = os.path.join(work_dir, "perf.data")
            perf_cmd = [
                "perf", "record",
                "-a", "-g",
                "-F", "999",
                "-e", "cpu-clock",
                "-o", perf_data,
                "--", "sleep", str(duration)
            ]
            start = time.time()
            proc = subprocess.run(
                perf_cmd,
                capture_output=True, text=True,
                timeout=duration + 10, cwd=work_dir
            )
            elapsed = time.time() - start

            # 4. Generate folded stacks
            user_folded = os.path.join(work_dir, "user.folded")
            kernel_folded = os.path.join(work_dir, "kernel.folded")

            # User-space stacks
            collapsed_text = ""
            perf_script = subprocess.run(
                ["perf", "script", "-i", perf_data],
                capture_output=True, text=True, timeout=30, cwd=work_dir
            )

            if perf_script.stdout.strip():
                print(f"[DEBUG] perf_script has {len(perf_script.stdout)} chars, {perf_script.stdout.count(chr(10))} lines", file=sys.stderr)
                # User stacks
                with open(os.path.join(work_dir, "perf_script.txt"), "w") as f:
                    f.write(perf_script.stdout)

                collapse = subprocess.run(
                    [str(STACKCOLLAPSE_PERF)],
                    input=perf_script.stdout,
                    capture_output=True, text=True, timeout=30, cwd=work_dir
                )

                collapsed_text = collapse.stdout.strip() if collapse.stdout else ""
            if collapsed_text:
                    with open(user_folded, "w") as f:
                        f.write(collapsed_text)

                    fg = subprocess.run(
                        [
                            str(FLAMEGRAPH_PL),
                            "--title", f"TraceOS CPU Flame Graph (User-Space, {duration}s sample)",
                            "--countname", "samples",
                            "--colors", "java",
                            "--hash",
                        ],
                        input=collapsed_text,
                        capture_output=True, text=True, timeout=30, cwd=work_dir
                    )
                    if fg.stdout.strip():
                        with open(user_svg, "w") as f:
                            f.write(fg.stdout)

            # 5. Extract kernel stacks from perf script output
            # Kernel frames are marked with [kernel.kallsyms] in perf script output

            # 6. Read SVG results
            user_svg_content = ""
            kernel_svg_content = ""

            if os.path.exists(user_svg) and os.path.getsize(user_svg) > 500:
                with open(user_svg, "r") as f:
                    user_svg_content = f.read()

            # Extract kernel stacks by filtering the collapsed output
            # (collapse first, then keep only lines containing kernel symbols)
            if collapsed_text:
                kernel_lines = []
                for line in collapsed_text.split("\n"):
                    # Kernel stacks contain kernel function names like [kernel.kallsyms]
                    # or have address patterns like ffffffff
                    if "[k]" in line or "[kernel" in line or "vmlinux" in line or "do_syscall" in line:
                        kernel_lines.append(line)
                
                if kernel_lines:
                    with open(kernel_folded, "w") as f:
                        f.write("\n".join(kernel_lines))
                    kfg = subprocess.run(
                        [str(FLAMEGRAPH_PL),
                         "--title", f"TraceOS Kernel Flame Graph ({duration}s sample)",
                         "--countname", "samples", "--colors", "io", "--hash"],
                        input="\n".join(kernel_lines),
                        capture_output=True, text=True, timeout=30, cwd=work_dir
                    )
                    if kfg.stdout.strip() and len(kfg.stdout.strip()) > 500:
                        with open(kernel_svg, "w") as f:
                            f.write(kfg.stdout)
                        with open(kernel_svg, "r") as f:
                            kernel_svg_content = f.read()
            
            # Also try bpftrace for kernel stacks (supplementary)
            if shutil.which("bpftrace") and not kernel_svg_content:
                try:
                    # Run binary in background and profile with bpftrace
                    import threading

                    bpftrace_output = os.path.join(work_dir, "kernel_stacks.txt")

                    # Start binary
                    loop_script = os.path.join(work_dir, "loop.sh")
                    with open(loop_script, "w") as lf:
                        lf.write("#!/bin/sh\nfor i in \$(seq 1 500); do\n  " + bin_path + " 2>/dev/null\n  sleep 0.001 2>/dev/null || true\ndone\n")
                    os.chmod(loop_script, 0o755)
                    bin_proc = subprocess.Popen(
                        [loop_script],
                        stdout=subprocess.DEVNULL,
                        stderr=subprocess.DEVNULL,
                        cwd=work_dir
                    )
                    pid = bin_proc.pid

                    # Profile with bpftrace
                    bt_cmd = [
                        "bpftrace", "-e",
                        f'profile:hz:999 /pid == {pid}/ {{ @[kstack(perf)] = count(); }} interval:s:{min(duration, 10)} {{ exit(); }}'
                    ]
                    bt_proc = subprocess.run(
                        bt_cmd,
                        capture_output=True, text=True,
                        timeout=duration + 5, cwd=work_dir
                    )

                    bin_proc.wait(timeout=5)

                    if bt_proc.stdout.strip():
                        with open(bpftrace_output, "w") as f:
                            f.write(bt_proc.stdout)

                        collapse_k = subprocess.run(
                            [str(STACKCOLLAPSE_BPFTRACE)],
                            input=bt_proc.stdout,
                            capture_output=True, text=True, timeout=30, cwd=work_dir
                        )

                        if collapse_k.stdout.strip():
                            fg_k = subprocess.run(
                                [
                                    str(FLAMEGRAPH_PL),
                                    "--title", f"TraceOS CPU Flame Graph (Kernel-Space, {duration}s sample)",
                                    "--countname", "samples",
                                    "--colors", "io",
                                    "--hash",
                                ],
                                input=collapse_k.stdout,
                                capture_output=True, text=True, timeout=30, cwd=work_dir
                            )
                            if fg_k.stdout.strip():
                                with open(kernel_svg, "w") as f:
                                    f.write(fg_k.stdout)
                                with open(kernel_svg, "r") as f:
                                    kernel_svg_content = f.read()
                except Exception:
                    pass  # bpftrace kernel profiling is optional

            
            # 6.5 Extract hot functions from collapsed stacks
            hot_functions, user_percent, kernel_percent = self._extract_hotspots(collapsed_text, user_folded, kernel_folded)

            # Build hotspot data for AI analysis
            hotspot_data = {
                "hot_functions": hot_functions,
                "user_percent": user_percent,
                "kernel_percent": kernel_percent,
            }

            # 7. Build response
            has_user = len(user_svg_content) > 500
            has_kernel = len(kernel_svg_content) > 500

            # Generate plain-language summary
            summary = self._build_summary(
                code, elapsed, proc.returncode if 'proc' in dir() else -1,
                has_user, has_kernel, user_svg_content
            )

            return {
                "success": True,
                "user_svg": user_svg_content if has_user else "",
                "kernel_svg": kernel_svg_content if has_kernel else "",
                "has_user": has_user,
                "has_kernel": has_kernel,
                "elapsed_sec": round(elapsed, 1),
                "summary": summary,
                **hotspot_data,
            }

        finally:
            # Cleanup
            try:
                bin_proc.kill()
            except:
                pass
            try:
                shutil.rmtree(work_dir, ignore_errors=True)
            except Exception:
                pass

    def _build_summary(self, code, elapsed, exit_code, has_user, has_kernel, svg):
        """Build plain-language summary for non-technical teachers."""
        parts = []

        if exit_code != 0 and exit_code != -1:
            parts.append(f"⚠️ 程序异常退出 (退出码: {exit_code})")

        if has_user:
            parts.append(f"✅ 已生成用户态火焰图，采样时长 {elapsed:.0f} 秒")
        else:
            parts.append("⚠️ 用户态采样数据不足（程序运行时间可能太短）")

        if has_kernel:
            parts.append("✅ 已生成内核态火焰图")

        # Look for common patterns in the SVG to give hints
        hints = []
        code_lower = code.lower()

        if "printf" in code_lower or "cout" in code_lower:
            hints.append("💡 程序中包含输出语句，可能消耗较多 I/O 时间")

        if "malloc" in code_lower or "new " in code_lower:
            hints.append("💡 程序中包含内存分配操作")

        if "sleep" in code_lower or "usleep" in code_lower:
            hints.append("💡 程序中包含 sleep 调用，火焰图中可能看到大量等待时间")

        if "for" in code_lower or "while" in code_lower:
            hints.append("🔍 火焰图中「宽」的色块代表 CPU 热点，点击可以深入查看")

        if not has_user and not has_kernel:
            hints.append("💡 提示：可以尝试增加采样时长或添加循环让程序运行更久")

        # Add guidance for reading flame graphs
        hints.append("📖 火焰图阅读指南：宽度 = CPU 占比 | 颜色区分函数 | 点击可交互缩放")

        parts.extend(hints)
        return "\n".join(parts)


    def _extract_hotspots(self, collapsed_text, user_folded_path, kernel_folded_path):
        """Extract top hotspot functions from collapsed perf data.

        Uses leaf-function attribution: for each stack trace, we credit the
        leaf function (last function in the semicolon-delimited stack) because
        that is the function actually on-CPU when the sample was taken.
        Kernel idle functions and JIT/perf-map markers are filtered out.
        """
        hot_functions = []
        user_percent = 0.0
        kernel_percent = 0.0

        if not collapsed_text or not collapsed_text.strip():
            return hot_functions, user_percent, kernel_percent

        # Known kernel idle / boot / housekeeping functions to skip
        KERNEL_IDLE_FUNCS = {
            "swapper", "do_idle", "cpu_idle", "cpuidle_idle_call",
            "default_idle_call", "arch_cpu_idle", "native_safe_halt",
            "cpu_startup_entry", "start_secondary", "secondary_startup_64_no_verify",
            "x86_64_start_kernel", "x86_64_start_reservations", "start_kernel",
            "arch_call_rest_init", "rest_init",
        }

        KERNEL_STACK_MARKERS = [
            "[k]", "[kernel", "vmlinux", "do_syscall", "sys_", "__x64_sys",
            "entry_SYSCALL", "page_fault", "irq_", "schedule", "ret_from_fork",
        ]

        leaf_counts = {}   # func_name -> {"count": int, "module": str}
        total_samples = 0
        kernel_samples = 0
        user_samples = 0

        for line in collapsed_text.strip().split("\n"):
            line = line.strip()
            if not line:
                continue
            parts = line.rsplit(" ", 1)
            if len(parts) != 2:
                continue
            stack, count_str = parts
            try:
                count = int(count_str)
            except ValueError:
                continue
            total_samples += count

            # Determine if this stack trace is kernel-side
            is_kernel = any(marker in stack for marker in KERNEL_STACK_MARKERS)
            if is_kernel:
                kernel_samples += count
            else:
                user_samples += count

            # Extract leaf function (last segment of the stack)
            funcs = [f.strip() for f in stack.split(";") if f.strip()]
            if not funcs:
                continue
            leaf = funcs[-1]

            # Clean up: remove offset/address info in parens
            clean_leaf = leaf.split("(")[0].strip() if "(" in leaf else leaf
            clean_leaf = clean_leaf.split("+")[0].strip()  # strip "+0x1234" style offsets

            # Skip noise
            if not clean_leaf or clean_leaf in ("[unknown]", "[perf]", " "):
                continue
            # Skip JIT / perf-map markers (look like [perf-XXXX.map] or [JIT])
            if clean_leaf.startswith("[perf-") or clean_leaf.startswith("[jit") or clean_leaf.startswith("[JIT"):
                continue
            # Skip shared-library / DSO wrappers
            if clean_leaf.startswith("[") and clean_leaf.endswith("]") and ".so" in clean_leaf:
                continue
            # Skip kernel idle functions
            if clean_leaf in KERNEL_IDLE_FUNCS:
                continue

            # Determine module
            module = "kernel" if is_kernel else "user"

            if clean_leaf not in leaf_counts:
                leaf_counts[clean_leaf] = {"count": 0, "module": module}
            leaf_counts[clean_leaf]["count"] += count

        if total_samples > 0:
            user_percent = round(user_samples * 100.0 / total_samples, 1)
            kernel_percent = round(kernel_samples * 100.0 / total_samples, 1)

        # Sort by count descending, take top 15
        sorted_funcs = sorted(leaf_counts.items(), key=lambda x: x[1]["count"], reverse=True)
        for func_name, info in sorted_funcs:
            pct = round(info["count"] * 100.0 / total_samples, 1) if total_samples > 0 else 0.0
            hot_functions.append({
                "name": func_name,
                "percent": pct,
                "module": info["module"],
            })
            if len(hot_functions) >= 15:
                break

        return hot_functions, user_percent, kernel_percent

    def _respond_json(self, data, status=200):
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(json.dumps(data, ensure_ascii=False).encode("utf-8"))

    def log_message(self, format, *args):
        # Simple logging to stderr
        print(f"[{time.strftime('%H:%M:%S')}] {args[0]}", file=sys.stderr)


def main():
    parser = argparse.ArgumentParser(description="TraceOS Flame Graph Server")
    parser.add_argument("--port", type=int, default=8765, help="Listen port")
    parser.add_argument("--host", default="0.0.0.0", help="Listen host")
    args = parser.parse_args()

    # Ensure output directory exists
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    # Check required tools
    has_perf = shutil.which("perf") is not None
    has_bpftrace = shutil.which("bpftrace") is not None
    has_flamegraph = FLAMEGRAPH_PL.exists()

    print(f"TraceOS Flame Graph Server starting on {args.host}:{args.port}", file=sys.stderr)
    print(f"  perf: {'✅' if has_perf else '❌'}", file=sys.stderr)
    print(f"  bpftrace: {'✅' if has_bpftrace else '❌'}", file=sys.stderr)
    print(f"  FlameGraph tools: {'✅' if has_flamegraph else '❌'}", file=sys.stderr)

    server = http.server.HTTPServer((args.host, args.port), FlameGraphHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down...", file=sys.stderr)
        server.shutdown()


if __name__ == "__main__":
    main()
