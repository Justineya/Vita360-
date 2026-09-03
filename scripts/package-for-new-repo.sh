#!/usr/bin/env bash
# Copy this project to a new directory, ready for git init.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DEST="${1:-}"

if [[ -z "$DEST" ]]; then
  echo "Usage: $0 <destination-directory>"
  echo "Example: $0 ~/projects/health-log"
  exit 1
fi

mkdir -p "$DEST"

copy_with_rsync() {
  rsync -av --delete \
    --exclude '.venv/' \
    --exclude 'data/health.db' \
    --exclude 'data/records/*' \
    --exclude '.env' \
    --exclude '__pycache__/' \
    --exclude '*.pyc' \
    --exclude '.git/' \
    "$ROOT/" "$DEST/"
}

copy_with_cp() {
  rm -rf "$DEST"
  mkdir -p "$DEST"
  if command -v tar >/dev/null 2>&1; then
    (cd "$ROOT" && tar cf - \
      --exclude='.venv' \
      --exclude='data/health.db' \
      --exclude='.env' \
      --exclude='__pycache__' \
      --exclude='.git' \
      .) | (cd "$DEST" && tar xf -)
    rm -rf "$DEST/data/records/"*
  else
    echo "需要 rsync 或 tar，或请手动复制 health-archive 目录内容"
    exit 1
  fi
}

if command -v rsync >/dev/null 2>&1; then
  copy_with_rsync
else
  copy_with_cp
fi

mkdir -p "$DEST/data/records"
touch "$DEST/data/records/.gitkeep"

echo ""
echo "Packaged to: $DEST"
echo "Next:"
echo "  cd $DEST"
echo "  cp .env.example .env   # add LLM_API_KEY"
echo "  bash scripts/setup.sh"
echo "  git init && git add . && git commit -m 'Initial commit'"
