#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if [[ ! -d .venv ]]; then
  python3 -m venv .venv 2>/dev/null || {
    echo "需要 python3-venv，或手动: pip install -r requirements.txt"
    pip install -r requirements.txt
  }
fi

if [[ -d .venv ]]; then
  # shellcheck disable=SC1091
  source .venv/bin/activate
fi

pip install -q -r requirements.txt

if [[ ! -f .env ]]; then
  cp .env.example .env
  echo "已创建 .env — 请填入 LLM_API_KEY 后重新运行"
  exit 0
fi

mkdir -p data/records
echo "启动 http://127.0.0.1:8765"
python -m app.main
