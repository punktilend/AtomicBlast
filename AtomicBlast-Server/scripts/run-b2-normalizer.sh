#!/usr/bin/env bash
set -euo pipefail

cd /opt/pulse-proxy

until node /opt/pulse-proxy/tools/b2-normalize-music.js --commit --quiet; do
  echo "[$(date -Iseconds)] retrying b2 normalizer in 30s" >> /opt/pulse-proxy/logs/b2-normalize-music.log
  sleep 30
done
