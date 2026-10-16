# TraceOS Lab — eBPF Program Compilation (v1 + v2)
#
# Requires:
#   clang >= 14, llvm-strip, bpftool
#   libbpf headers: apt install libbpf-dev
#
# CO-RE path (recommended, requires BTF kernel):
#   make ebpf-v2-core          — compile all v2 CO-RE BPF objects
#   make install-v2-core       — install v2 CO-RE objects to core-service
#
# Non-CO-RE path (kernel-bound, no BTF required):
#   make ebpf-v2-nocore        — compile v2 non-CO-RE BPF objects
#   make install-v2-nocore     — install v2 non-CO-RE objects to core-service
#
# Legacy v1 targets (for backward compat during migration):
#   make all                   — compile all v1 BPF objects
#   make install               — install v1 objects to core-service
#
# Full build:
#   make build                 — v2-core (primary) + v2-nocore (fallback)

CLANG       ?= clang
LLVM_STRIP  ?= llvm-strip
BPFTOOL     ?= bpftool

ARCH := $(shell uname -m | sed 's/x86_64/x86/' | sed 's/aarch64/arm64/')
BPF_CFLAGS  := -O2 -g -target bpf -D__TARGET_ARCH_$(ARCH)
BPF_CFLAGS  += -I/usr/include/$(shell uname -m)-linux-gnu
BPF_CFLAGS  += -I/usr/include
BPF_CFLAGS  += -Wall -Wno-compare-distinct-pointer-types

# ── Install destination ─────────────────────────────────────────────

INSTALL_DIR := ../../services/core-service/bpf

# ═══════════════════════════════════════════════════════════════════
# V1 targets (legacy, single target_pid per program)
# ═══════════════════════════════════════════════════════════════════

V1_OBJS := syscall_trace.bpf.o futex_deadlock.bpf.o mem_trace.bpf.o

.PHONY: all clean vmlinux syscall deadlock mem

all: vmlinux.h $(V1_OBJS)
	@echo "✅ All V1 BPF objects compiled"

syscall: vmlinux.h syscall_trace.bpf.o
deadlock: vmlinux.h futex_deadlock.bpf.o
mem: vmlinux.h mem_trace.bpf.o

# ═══════════════════════════════════════════════════════════════════
# V2 targets (global singleton, HASH_OF_MAPS sandbox isolation)
# ═══════════════════════════════════════════════════════════════════

V2_CORE_OBJS := syscall_trace_v2.bpf.o futex_deadlock_v2.bpf.o mem_trace_v2.bpf.o
V2_CORE_DEPS := trace_common_v2.h

.PHONY: ebpf-v2-core clean-v2-core

ebpf-v2-core: vmlinux.h $(V2_CORE_OBJS)
	@echo "✅ All V2 CO-RE BPF objects compiled"

# Non-CO-RE: no vmlinux.h, uses hardcoded struct offsets + userspace
# populated pid_start_times map. Kernel-version-bound (tested on 5.15).
V2_NOCORE_OBJS := syscall_trace_v2_nocore.bpf.o
V2_NOCORE_DEPS := trace_common_v2_nocore.h

.PHONY: ebpf-v2-nocore clean-v2-nocore

ebpf-v2-nocore: $(V2_NOCORE_OBJS)
	@echo "✅ All V2 non-CO-RE BPF objects compiled"

# ── Convenience: full build ─────────────────────────────────────────

.PHONY: build

build: ebpf-v2-core ebpf-v2-nocore
	@echo "✅ Full build complete (v2-core + v2-nocore)"

# ═══════════════════════════════════════════════════════════════════
# Compilation rules
# ═══════════════════════════════════════════════════════════════════

# vmlinux.h: CO-RE type definitions from running kernel
vmlinux.h:
	@echo "  GEN  vmlinux.h"
	@bpftool btf dump file /sys/kernel/btf/vmlinux format c > vmlinux.h 2>/dev/null || \
		(echo "❌ BTF not available.  Install a BTF-enabled kernel or use ebpf-v2-nocore." && false)
	@echo "✅ vmlinux.h generated"

# Generic BPF compilation rule
%.bpf.o: %.bpf.c
	@echo "  CC  $@"
	$(CLANG) $(BPF_CFLAGS) -c $< -o $@
	$(LLVM_STRIP) -g $@

# ── Per-object dependency declarations ──────────────────────────────

# V1 (order-only deps — vmlinux.h existence matters, not timestamp)
syscall_trace.bpf.o: vmlinux.h
futex_deadlock.bpf.o: vmlinux.h
mem_trace.bpf.o: vmlinux.h

# V2 CO-RE
syscall_trace_v2.bpf.o: vmlinux.h trace_common_v2.h
futex_deadlock_v2.bpf.o: vmlinux.h trace_common_v2.h
mem_trace_v2.bpf.o: vmlinux.h trace_common_v2.h

# V2 non-CO-RE
syscall_trace_v2_nocore.bpf.o: trace_common_v2_nocore.h

# ═══════════════════════════════════════════════════════════════════
# Installation
# ═══════════════════════════════════════════════════════════════════

.PHONY: install install-v2-core install-v2-nocore

install: all
	@mkdir -p $(INSTALL_DIR)
	cp -v $(V1_OBJS) $(INSTALL_DIR)/
	@echo "✅ V1 objects installed to $(INSTALL_DIR)"

install-v2-core: ebpf-v2-core
	@mkdir -p $(INSTALL_DIR)
	cp -v $(V2_CORE_OBJS) $(INSTALL_DIR)/
	@echo "✅ V2 CO-RE objects installed to $(INSTALL_DIR)"

install-v2-nocore: ebpf-v2-nocore
	@mkdir -p $(INSTALL_DIR)
	cp -v $(V2_NOCORE_OBJS) $(INSTALL_DIR)/
	@echo "✅ V2 non-CO-RE objects installed to $(INSTALL_DIR)"

# ═══════════════════════════════════════════════════════════════════
# Verification
# ═══════════════════════════════════════════════════════════════════

.PHONY: check check-v2-core check-v2-nocore check-all

check: all
	@for obj in $(V1_OBJS); do \
		echo -n "  $$obj: "; \
		readelf -S $$obj 2>/dev/null | grep -q ".text" && echo "✅ valid" || echo "❌ INVALID"; \
	done

check-v2-core: ebpf-v2-core
	@for obj in $(V2_CORE_OBJS); do \
		echo -n "  $$obj: "; \
		readelf -S $$obj 2>/dev/null | grep -q ".text" && echo "✅ valid" || echo "❌ INVALID"; \
	done

check-v2-nocore: ebpf-v2-nocore
	@for obj in $(V2_NOCORE_OBJS); do \
		echo -n "  $$obj: "; \
		readelf -S $$obj 2>/dev/null | grep -q ".text" && echo "✅ valid" || echo "❌ INVALID"; \
	done

check-all: check check-v2-core check-v2-nocore

# ═══════════════════════════════════════════════════════════════════
# Cleanup
# ═══════════════════════════════════════════════════════════════════

.PHONY: clean clean-v2-core clean-v2-nocore clean-all

clean:
	rm -f $(V1_OBJS)

clean-v2-core:
	rm -f $(V2_CORE_OBJS)

clean-v2-nocore:
	rm -f $(V2_NOCORE_OBJS)

clean-all: clean clean-v2-core clean-v2-nocore
	rm -f vmlinux.h