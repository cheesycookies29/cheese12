#!/bin/bash
# Double-click in Finder to start Lancaster ATLAS. Keep the window open while you use it;
# close it (or press Ctrl+C) to stop ATLAS.
cd "$(dirname "$0")" || exit 1
# Finder does not always pass on the PATH where Node.js is installed.
export PATH="/usr/local/bin:/opt/homebrew/bin:$HOME/.volta/bin:$PATH"
[ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1

if ! command -v node >/dev/null 2>&1; then
  echo
  echo "  Node.js is not installed."
  echo "  Download the LTS version from https://nodejs.org, install it, then double-click this file again."
  echo
  read -r -p "  Press Return to close this window."
  exit 1
fi

echo
echo "  Starting Lancaster ATLAS. Your browser will open in a moment."
echo "  Keep this window open while you use ATLAS. Close it to stop ATLAS."
OPEN_BROWSER=1 node server.js
echo
read -r -p "  ATLAS has stopped. Press Return to close this window."
