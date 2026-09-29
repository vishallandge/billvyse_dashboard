#!/usr/bin/env bash
# Builds the Print Bridge downloads ON THE SERVER and puts them where nginx serves them:
#
#   bash /var/www/billvyse/dashboard/print-bridge/make-zip.sh
#
# Each zip carries the official Node runtime from nodejs.org (checksum-verified) plus
# bridge.js and a start script — nothing to install on the shop computer. Node's own
# binaries are signed by the OpenJS Foundation, so Windows/macOS warn far less than they
# would for an unsigned .exe of ours.

set -euo pipefail

NODE_VERSION="v22.14.0"
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="${BV_DOWNLOADS_DIR:-/var/www/billvyse-downloads}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

if ! command -v zip >/dev/null || ! command -v unzip >/dev/null; then
  echo "zip/unzip install ho raha hai…"
  apt-get install -y zip unzip >/dev/null
fi

echo "Node $NODE_VERSION download ho raha hai (ek minute lagega)…"
BASE="https://nodejs.org/dist/$NODE_VERSION"
curl -fsSL "$BASE/SHASUMS256.txt" -o "$WORK/SHASUMS256.txt"

fetch() { # file name on nodejs.org → verified local copy
  curl -fsSL "$BASE/$1" -o "$WORK/$1"
  (cd "$WORK" && grep " $1\$" SHASUMS256.txt | sha256sum -c --quiet -)
}

# ---- Windows ----
fetch "node-$NODE_VERSION-win-x64.zip"
mkdir -p "$WORK/win"
unzip -q -j "$WORK/node-$NODE_VERSION-win-x64.zip" "node-$NODE_VERSION-win-x64/node.exe" -d "$WORK/win"
cp "$HERE/bridge.js" "$HERE/Start Print Bridge.bat" "$HERE/Start with Windows.bat" "$WORK/win/"
(cd "$WORK/win" && zip -q -X "$WORK/billvyse-print-bridge.zip" ./*)

# ---- Mac (Apple Silicon + Intel; the start script picks the right one) ----
mkdir -p "$WORK/mac"
for ARCH in arm64 x64; do
  fetch "node-$NODE_VERSION-darwin-$ARCH.tar.gz"
  tar -xzf "$WORK/node-$NODE_VERSION-darwin-$ARCH.tar.gz" -C "$WORK" "node-$NODE_VERSION-darwin-$ARCH/bin/node"
  cp "$WORK/node-$NODE_VERSION-darwin-$ARCH/bin/node" "$WORK/mac/node-$ARCH"
  chmod 755 "$WORK/mac/node-$ARCH"
done
cp "$HERE/bridge.js" "$HERE/Start Print Bridge (Mac).command" "$WORK/mac/"
chmod 755 "$WORK/mac/Start Print Bridge (Mac).command"
(cd "$WORK/mac" && zip -q -X "$WORK/billvyse-print-bridge-mac.zip" ./*)

mkdir -p "$OUT"
install -m 644 "$WORK/billvyse-print-bridge.zip" "$OUT/billvyse-print-bridge.zip"
install -m 644 "$WORK/billvyse-print-bridge-mac.zip" "$OUT/billvyse-print-bridge-mac.zip"

echo ""
echo "✅ HO GAYA — dono zip ready:"
ls -lh "$OUT"
