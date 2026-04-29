#!/usr/bin/env bash
# 100% 로컬 런처 (macOS / Linux) — 더블클릭 또는 ./start.sh

set -e
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
    echo
    echo "[X] Node.js 가 설치돼 있지 않습니다."
    echo "    https://nodejs.org 에서 LTS 버전 설치 후 다시 실행하세요."
    echo
    exit 1
fi

node scripts/launch.cjs
