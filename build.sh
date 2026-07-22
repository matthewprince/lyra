#!/bin/sh
# Bundle Lyra into dist/lyra.js (plain concatenation; the sources are IIFEs).
set -e
cd "$(dirname "$0")"
mkdir -p dist
{
  echo "/* Lyra lyric renderer - built $(date -u +%Y-%m-%dT%H:%M:%SZ) */"
  cat src/ttml.js src/engine.js src/bg.js
} > dist/lyra.js
node --check dist/lyra.js 2>/dev/null && echo "dist/lyra.js OK ($(wc -c < dist/lyra.js) bytes)" || {
  # node may be absent from bash PATH (fnm hooks fish only); try fnm's install dir
  NODEBIN="$(ls -d "$HOME"/.local/share/fnm/node-versions/*/installation/bin/node 2>/dev/null | tail -1)"
  if [ -n "$NODEBIN" ]; then "$NODEBIN" --check dist/lyra.js && echo "dist/lyra.js OK ($(wc -c < dist/lyra.js) bytes)"
  else echo "dist/lyra.js written (no node found for syntax check)"; fi
}
