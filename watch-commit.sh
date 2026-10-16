#!/bin/bash
REPO_DIR="/root/traceos-lab"
LOGFILE="$REPO_DIR/watch-commit.log"
cd "$REPO_DIR" || exit 1
echo "[$(date)] Watcher started" >> "$LOGFILE"
inotifywait -m -r --exclude "(\.git/|node_modules/|\.next/|__pycache__/|\.o$)" -e modify -e create -e delete -e move --format "%w%f" "$REPO_DIR" | while read file; do
    sleep 30
    if git diff --quiet && git diff --cached --quiet; then
        continue
    fi
    NOW=$(date "+%Y-%m-%d %H:%M")
    HOSTNAME=$(hostname)
    CHANGES=$(git status --short | wc -l | tr -d " ")
    git add -A
    git commit -m "auto: ${NOW} — ${CHANGES} files changed [${HOSTNAME}]" 2>&1 >> "$LOGFILE"
    git pull --rebase origin master 2>&1 >> "$LOGFILE"
    git push origin master 2>&1 >> "$LOGFILE"
    echo "[$(date)] Committed & pushed ($CHANGES files)" >> "$LOGFILE"
done
