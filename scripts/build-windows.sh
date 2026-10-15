#!/usr/bin/env bash
# Builds dist/LTDC-ERP-Windows-x64.zip: the app plus a portable Node.js runtime,
# so it runs on Windows by double-clicking, with nothing to install.
# Usage: scripts/build-windows.sh            (uses NODE_VERSION below)
#        NODE_VERSION=v22.23.3 scripts/build-windows.sh
set -euo pipefail

NODE_VERSION="${NODE_VERSION:-v22.23.3}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/dist"
CACHE="$OUT/cache"
WORK="$OUT/work"
PKG="$WORK/LTDC-ERP"
NODE_ZIP="node-$NODE_VERSION-win-x64.zip"

mkdir -p "$CACHE"
rm -rf "$WORK" && mkdir -p "$PKG/runtime"

# 1. Official Windows Node.js build, verified against nodejs.org's published checksums.
if [ ! -f "$CACHE/$NODE_ZIP" ]; then
  curl -fsSL -o "$CACHE/$NODE_ZIP" "https://nodejs.org/dist/$NODE_VERSION/$NODE_ZIP"
fi
curl -fsSL -o "$CACHE/SHASUMS256-$NODE_VERSION.txt" "https://nodejs.org/dist/$NODE_VERSION/SHASUMS256.txt"
(cd "$CACHE" && grep " $NODE_ZIP\$" "SHASUMS256-$NODE_VERSION.txt" | sha256sum -c -)
unzip -q -j "$CACHE/$NODE_ZIP" "node-$NODE_VERSION-win-x64/node.exe" "node-$NODE_VERSION-win-x64/LICENSE" -d "$PKG/runtime"
mv "$PKG/runtime/LICENSE" "$PKG/runtime/NODE-LICENSE.txt"

# 2. The app itself: only files committed to git (never data/ or local files).
git -C "$ROOT" archive HEAD server.js server shared public scripts package.json README.md | tar -x -C "$PKG"
rm -f "$PKG/scripts/build-windows.sh"

# 3. Windows launchers, icon and read-me.
cp "$ROOT"/packaging/windows/* "$PKG/"
{
  echo "LTDC ERP - Windows x64"
  echo "App version: $(git -C "$ROOT" rev-parse --short HEAD) ($(git -C "$ROOT" log -1 --format=%cd --date=short))"
  echo "Node.js runtime: $NODE_VERSION (official build from nodejs.org, checksum verified)"
  echo "Built: $(date -u +%Y-%m-%dT%H:%MZ)"
} | sed 's/$/\r/' > "$PKG/VERSION.txt"

printf '{"commit":"%s","installedAt":"%s","channel":"windows"}\n' "$(git -C "$ROOT" rev-parse HEAD)" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$PKG/build.json"

# 4. Zip it.
rm -f "$OUT/LTDC-ERP-Windows-x64.zip"
(cd "$WORK" && zip -q -r -9 -X "$OUT/LTDC-ERP-Windows-x64.zip" LTDC-ERP)
echo "Built $OUT/LTDC-ERP-Windows-x64.zip ($(du -h "$OUT/LTDC-ERP-Windows-x64.zip" | cut -f1))"
