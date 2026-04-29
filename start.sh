#!/usr/bin/env bash
# 100% local launcher (macOS / Linux) — double-click or ./start.sh

set -e
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
    echo
    echo "Node.js not found on this system."
    echo
    echo "macOS:   brew install node"
    echo "Ubuntu:  sudo apt install nodejs npm"
    echo "Other:   https://nodejs.org (download LTS)"
    echo
    exit 1
fi

node scripts/launch.cjs
