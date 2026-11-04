#!/usr/bin/env bash
set -e
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"
echo "Starting Sticky Character Studio on http://localhost:3456 ..."
if command -v xdg-open >/dev/null 2>&1; then
  (sleep 1 && xdg-open "http://localhost:3456" >/dev/null 2>&1) &
fi
exec node server.js
