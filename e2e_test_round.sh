#!/bin/bash
# 全链路真实打分测试：注册 → 提交 → 轮询 → 断言分数。
# 双重断言：
#   1) golden 正确解（fork + wait）→ 100 分、qualified、5/5
#   2) wrong 错误解（fork 但漏掉 wait，子进程变僵尸）→ 80 分、未达标、4/5
set -u

API="${API:-http://127.0.0.1}"
EXP="${EXP:-18a1e110-bbd6-4c2a-803d-bcc91fe27469}"  # 进程创建与父子关系 (easy, 5 test cases)

TS=$(date +%s)
USER="e2escore_${TS}"
PASS="Test@12345"
FAIL=0

log() { echo "[e2e] $*"; }

register() {
  local reg token
  reg=$(curl -s -X POST "$API/api/v1/auth/register" -H 'Content-Type: application/json' \
    -d "{\"username\":\"$USER\",\"email\":\"$USER@test.com\",\"password\":\"$PASS\",\"full_name\":\"E2E Score\",\"role\":\"student\"}")
  token=$(echo "$reg" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("access_token",""))' 2>/dev/null)
  if [ -z "$token" ]; then
    log "register failed: $reg"
    exit 1
  fi
  echo "$token"
}

submit() {
  local token="$1" code_file="$2"
  local code sub subid
  code=$(python3 -c 'import sys,json; print(json.dumps(open(sys.argv[1]).read()))' "$code_file")
  sub=$(curl -s -X POST "$API/api/v1/submissions" -H "Authorization: Bearer $token" -H 'Content-Type: application/json' \
    -d "{\"experiment_id\":\"$EXP\",\"language\":\"c\",\"code\":$code}")
  subid=$(echo "$sub" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("submission_id",""))' 2>/dev/null)
  if [ -z "$subid" ]; then
    log "submit failed: $sub"
    exit 1
  fi
  echo "$subid"
}

poll() {
  local token="$1" subid="$2"
  local res st i
  for i in $(seq 1 30); do
    sleep 2
    res=$(curl -s "$API/api/v1/submissions/$subid" -H "Authorization: Bearer $token")
    st=$(echo "$res" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("status",""))' 2>/dev/null)
    case "$st" in
      completed|failed|compile_error) echo "$res"; return 0 ;;
    esac
  done
  echo "$res"
}

# 断言一次提交的分数/达标/通过数。JSON 经环境变量传入，避免 f-string 反斜杠问题。
check() {
  local res="$1" exp_score="$2" exp_qual="$3" exp_passed="$4" label="$5"
  RES="$res" EXP_SCORE="$exp_score" EXP_QUAL="$exp_qual" EXP_PASSED="$exp_passed" LABEL="$label" python3 - <<'PY'
import os, json, sys
r = json.loads(os.environ["RES"])
exp_score = int(os.environ["EXP_SCORE"])
exp_qual = os.environ["EXP_QUAL"] == "true"
exp_passed = int(os.environ["EXP_PASSED"])
label = os.environ["LABEL"]

score = r.get("score")
qual = r.get("is_qualified")
passed = r.get("passed_test_cases")
tot = r.get("total_test_cases")
core = r.get("core_score")
edge = r.get("edge_score")
pts = r.get("test_points") or []

print(f"[{label}] score={score} total={tot} core={core} edge={edge} qualified={qual} passed={passed}/{tot}")
for p in pts:
    fr = (p.get("fail_reason") or "")[:60]
    print(f"    - {p.get('type')}/{p.get('name')}: passed={p.get('passed')} weight={p.get('weight')} fail={fr!r}")

ok = (score == exp_score) and (qual == exp_qual) and (passed == exp_passed)
print(f"[{label}] RESULT: {'PASS' if ok else 'FAIL'} (expected score={exp_score} qualified={exp_qual} passed={exp_passed}/{tot})")
sys.exit(0 if ok else 1)
PY
}

TOKEN=$(register)
log "registered user: $USER"

cat > /tmp/e2e_golden.c <<'EOF'
#include <stdio.h>
#include <unistd.h>
#include <sys/wait.h>
#include <stdlib.h>

int main() {
    pid_t pid = fork();
    if (pid < 0) {
        perror("fork");
        return 1;
    } else if (pid == 0) {
        printf("Child: PID=%d, PPID=%d\n", getpid(), getppid());
        _exit(0);
    } else {
        int status;
        pid_t child_pid = wait(&status);
        printf("Parent: PID=%d, Child PID=%d\n", getpid(), child_pid);
    }
    return 0;
}
EOF

log "submit golden solution (fork + wait)"
GID=$(submit "$TOKEN" /tmp/e2e_golden.c)
GRES=$(poll "$TOKEN" "$GID")
check "$GRES" 100 true 5 "golden" || FAIL=1

cat > /tmp/e2e_wrong.c <<'EOF'
#include <stdio.h>
#include <unistd.h>
#include <stdlib.h>

int main() {
    pid_t pid = fork();
    if (pid < 0) {
        perror("fork");
        return 1;
    } else if (pid == 0) {
        printf("Child: PID=%d, PPID=%d\n", getpid(), getppid());
        _exit(0);
    } else {
        printf("Parent: PID=%d, Child PID=%d\n", getpid(), pid);
        sleep(1); /* BUG: 未调用 wait() 回收子进程 → wait4 缺失 + 僵尸 */
    }
    return 0;
}
EOF

log "submit wrong solution (fork, missing wait)"
WID=$(submit "$TOKEN" /tmp/e2e_wrong.c)
WRES=$(poll "$TOKEN" "$WID")
check "$WRES" 80 false 4 "wrong" || FAIL=1

if [ "$FAIL" -ne 0 ]; then
  log "E2E FAILED"
  exit 1
fi
log "E2E PASSED: golden=100, wrong=80"