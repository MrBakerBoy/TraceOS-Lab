# traceos-lab-sandbox — Docker image for OS experiment execution
#
# This image provides a standardized, minimal Linux environment with:
#   - strace (system call tracing)
#   - GCC, G++ (C/C++ compilation)
#   - Python3 + pip
#   - Common dev libraries (pthread, math, etc.)
#   - Non-root user for security
#
# Build:
#   docker build -t traceos-lab-sandbox:latest -f docker/sandbox/Dockerfile docker/sandbox/
#   docker tag traceos-lab-sandbox:latest traceos-lab-sandbox:standard
#   docker tag traceos-lab-sandbox:latest traceos-lab-sandbox:secure
#
# Run (test):
#   docker run --rm --network=none --read-only \
#     --tmpfs /tmp:rw,noexec,nosuid,size=64m \
#     traceos-lab-sandbox:latest strace -tt -k /bin/echo "hello"

FROM alpine:3.19

LABEL org.traceos.lab.sandbox="true"
LABEL description="TraceOS Lab Sandbox — OS experiment execution environment"

# ── Install toolchain ────────────────────────────────────────────────
RUN apk add --no-cache \
    # System call tracing
    strace \
    # C/C++ toolchain
    gcc g++ musl-dev make \
    # Python
    python3 py3-pip \
    # Common libraries
    linux-headers \
    # Utilities
    bash binutils coreutils \
    # Debug symbols for addr2line
    binutils-doc \
    && rm -rf /var/cache/apk/*

# ── Ensure common library symlinks ──────────────────────────────────
RUN ln -sf /usr/lib/libpthread.so /usr/lib/libpthread.so.0 2>/dev/null || true

# ── Create non-root user for execution ──────────────────────────────
RUN adduser -D -s /bin/sh -h /home/sandbox sandbox

# ── Create working directories ──────────────────────────────────────
RUN mkdir -p /work /strace && chown sandbox:sandbox /work /strace /tmp

# ── Security hardening ──────────────────────────────────────────────
# Remove unnecessary setuid binaries
RUN find / -perm /6000 -type f 2>/dev/null | xargs -r chmod a-s 2>/dev/null || true

# Default to sandbox user
USER sandbox
WORKDIR /work

# Verify toolchain
RUN gcc --version && \
    g++ --version && \
    python3 --version && \
    strace --version && \
    echo "TraceOS Lab Sandbox ready."
