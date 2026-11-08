#!/usr/bin/env bash
# Builds dist/CORE-ERP.exe: one Windows file that holds Node.js, the server and every web
# file (Node's single executable application feature). Nothing to install or unzip: double-click
# it and CORE opens in the browser. Data is kept on the PC in %LOCALAPPDATA%\CORE ERP.
#
# Usage: scripts/build-exe.sh               (Windows .exe)
#        LINUX=1 scripts/build-exe.sh       (also dist/core-erp-linux, to test the same build here)
# Needs curl, tar, xz, unzip and npm (build-time tools go in dist/cache, not in the app).
set -euo pipefail

NODE_VERSION="${NODE_VERSION:-v22.23.3}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/dist"
CACHE="$OUT/cache"
TOOLS="$CACHE/exe-tools"
WORK="$OUT/exe-work"
VERSION="$(node -p "require('$ROOT/package.json').version")"
COMMIT="$(git -C "$ROOT" rev-parse HEAD)"
BUILD="${VERSION}-$(git -C "$ROOT" rev-parse --short=8 HEAD)"

mkdir -p "$CACHE" "$TOOLS"
rm -rf "$WORK" && mkdir -p "$WORK/assets"

# 1. Official Node.js builds, checked against nodejs.org's checksums: the Windows one becomes
#    the .exe; the Linux one prepares the embedded app (same version, so the formats match).
curl -fsSL -o "$CACHE/SHASUMS256-$NODE_VERSION.txt" "https://nodejs.org/dist/$NODE_VERSION/SHASUMS256.txt"
for f in "node-$NODE_VERSION-win-x64.zip" "node-$NODE_VERSION-linux-x64.tar.xz"; do
  [ -f "$CACHE/$f" ] || curl -fsSL -o "$CACHE/$f" "https://nodejs.org/dist/$NODE_VERSION/$f"
  (cd "$CACHE" && grep " $f\$" "SHASUMS256-$NODE_VERSION.txt" | sha256sum -c - >/dev/null)
done
[ -x "$CACHE/node-$NODE_VERSION-linux-x64/bin/node" ] || tar -xJf "$CACHE/node-$NODE_VERSION-linux-x64.tar.xz" -C "$CACHE"
NODE="$CACHE/node-$NODE_VERSION-linux-x64/bin/node"
unzip -q -o -j "$CACHE/node-$NODE_VERSION-win-x64.zip" "node-$NODE_VERSION-win-x64/node.exe" -d "$WORK"

# 2. Build-time tools: esbuild (bundles the server), postject (puts it in the .exe),
#    resedit (icon and version details). Pinned versions; not part of the app.
if [ ! -d "$TOOLS/node_modules/resedit" ]; then
  (cd "$TOOLS" && npm init -y >/dev/null && npm install --no-audit --no-fund esbuild@0.24.2 postject@1.0.0-alpha.6 resedit@2.0.3 >/dev/null)
fi

# 3. The server as one CommonJS script (what a single executable runs).
"$TOOLS/node_modules/.bin/esbuild" "$ROOT/packaging/exe/main.js" --bundle --platform=node --format=cjs --target=node22 \
  --define:import.meta.url=__coreUrl --banner:js='const __coreUrl = require("url").pathToFileURL(__filename).href;' \
  --log-level=warning --outfile="$WORK/core.cjs"

# 4. Web files, from git only (never data/ or local files), embedded as assets.
FILES=$(git -C "$ROOT" ls-files public shared docs/guides)
ROOT="$ROOT" WORK="$WORK" node -e '
  const [files, build, version, commit] = process.argv.slice(1);
  const list = files.split("\n").filter(Boolean);
  const assets = Object.fromEntries(list.map((f) => [f, process.env.ROOT + "/" + f]));
  require("fs").writeFileSync(process.env.WORK + "/assets/manifest.json", JSON.stringify({ build, files: list, buildInfo: { commit, channel: "windows-exe", version } }));
  assets["manifest.json"] = process.env.WORK + "/assets/manifest.json";
  require("fs").writeFileSync(process.env.WORK + "/sea-config.json", JSON.stringify({
    main: process.env.WORK + "/core.cjs", output: process.env.WORK + "/sea.blob",
    disableExperimentalSEAWarning: true, useSnapshot: false, useCodeCache: false, assets }, null, 2));
' "$FILES" "$BUILD" "$VERSION" "$COMMIT"
(cd "$WORK" && "$NODE" --experimental-sea-config sea-config.json >/dev/null)

# 5. The .exe: the app goes in first, then the icon and version details (resedit keeps the
#    app's resource; postject cannot work on a file resedit has rewritten). Then a check.
cp "$WORK/node.exe" "$WORK/CORE-ERP.exe"
"$TOOLS/node_modules/.bin/postject" "$WORK/CORE-ERP.exe" NODE_SEA_BLOB "$WORK/sea.blob" \
  --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2 >/dev/null
"$NODE" "$ROOT/packaging/exe/set-resources.mjs" "$WORK/CORE-ERP.exe" "$ROOT/packaging/windows/app.ico" "$VERSION" "$TOOLS"
"$NODE" "$ROOT/packaging/exe/check-exe.mjs" "$WORK/CORE-ERP.exe" "$WORK/sea.blob" "$TOOLS"
mv "$WORK/CORE-ERP.exe" "$OUT/CORE-ERP.exe"
echo "Built $OUT/CORE-ERP.exe ($(du -h "$OUT/CORE-ERP.exe" | cut -f1), build $BUILD)"

if [ -n "${LINUX:-}" ]; then
  cp "$NODE" "$OUT/core-erp-linux"
  "$TOOLS/node_modules/.bin/postject" "$OUT/core-erp-linux" NODE_SEA_BLOB "$WORK/sea.blob" \
    --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2 >/dev/null
  echo "Built $OUT/core-erp-linux (for testing)"
fi
rm -rf "$WORK"
