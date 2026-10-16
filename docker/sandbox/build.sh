#!/bin/bash
# Build the TraceOS Lab Docker sandbox image
# This image provides the standardized execution environment for OS experiments.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

IMAGE_NAME="${1:-traceos-lab-sandbox}"

echo "=== Building TraceOS Lab Sandbox Image ==="
docker build -t "${IMAGE_NAME}:latest" -f Dockerfile .

# Tag for different sandbox levels
docker tag "${IMAGE_NAME}:latest" "${IMAGE_NAME}:standard"
docker tag "${IMAGE_NAME}:latest" "${IMAGE_NAME}:secure"

echo ""
echo "=== Build Complete ==="
echo "Images:"
echo "  ${IMAGE_NAME}:latest"
echo "  ${IMAGE_NAME}:standard  (Level 1 - process/fs labs, 256MB/80%CPU)"
echo "  ${IMAGE_NAME}:secure    (Level 2/3 - thread/memory/deadlock labs, 128MB/60%CPU)"

echo ""
echo "=== Verify ==="
docker run --rm "${IMAGE_NAME}:latest" gcc --version | head -1
docker run --rm "${IMAGE_NAME}:latest" python3 --version
docker run --rm "${IMAGE_NAME}:latest" strace --version | head -1

echo ""
echo "=== Test Execution ==="
echo 'int main() { return 0; }' > /tmp/test_sandbox.c
docker run --rm --network=none --read-only \
  --tmpfs /tmp:rw,noexec,nosuid,size=64m \
  -v /tmp/test_sandbox.c:/work/test.c:ro \
  "${IMAGE_NAME}:latest" \
  sh -c "gcc -o /tmp/a.out /work/test.c && /tmp/a.out && echo 'PASS: compiled and executed'"
rm -f /tmp/test_sandbox.c
