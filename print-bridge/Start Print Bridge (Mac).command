#!/bin/bash
# Double-click in Finder to start the BillVyse Print Bridge. Keep the Terminal window open.
cd "$(dirname "$0")"
ARCH="$(uname -m)"
if [ "$ARCH" = "arm64" ] && [ -x "./node-arm64" ]; then
  ./node-arm64 bridge.js
elif [ -x "./node-x64" ]; then
  ./node-x64 bridge.js
elif [ -x "./billvyse-print-bridge-mac" ]; then
  ./billvyse-print-bridge-mac
else
  node bridge.js
fi
