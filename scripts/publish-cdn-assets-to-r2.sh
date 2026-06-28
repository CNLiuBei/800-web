#!/usr/bin/env bash
# Publish CDN-only assets to flix-800-assets (cdn.guangying.org).
#
# Web 前端（src/styles/icons）随 Worker 同源部署，不再上传 R2。
#
# Usage:
#   ./scripts/publish-cdn-assets-to-r2.sh           # Shaka Player
#   ./scripts/publish-cdn-assets-to-r2.sh shaka
#   ./scripts/publish-cdn-assets-to-r2.sh web       # 已废弃，仅提示
#
# 发 Web：node scripts/sync-static-version.mjs && npx wrangler deploy
# 播放器：packages/gy-player (`npm run deploy`)
#
# Requires CLOUDFLARE_API_TOKEN (or wrangler login) and access to the R2 bucket.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUCKET="${R2_BUCKET:-flix-800-assets}"
CDN_BASE="${CDN_BASE:-https://cdn.guangying.org}"
SHAKA_VERSION="${SHAKA_PLAYER_VERSION:-4.16.37}"
SHAKA_KEY="${SHAKA_PLAYER_R2_KEY:-static/vendor/shaka-player.compiled.js}"
SHAKA_SOURCE="${ROOT}/vendor/shaka-player.compiled.js"

if ! command -v npx >/dev/null 2>&1; then
  echo "npx is required to run wrangler" >&2
  exit 1
fi

put_object() {
  local key="$1"
  local file="$2"
  local content_type="$3"
  local cache_control="${4:-public, max-age=31536000, immutable}"
  local attempts=0
  echo "Publishing $file -> r2://${BUCKET}/${key}"
  while true; do
    attempts=$((attempts + 1))
    if npx wrangler r2 object put "${BUCKET}/${key}" \
        --remote \
        --file "$file" \
        --content-type "$content_type" \
        --cache-control "$cache_control"; then
      return 0
    fi
    if [[ $attempts -ge 4 ]]; then
      echo "  ✘ Failed after ${attempts} attempts: $file" >&2
      return 1
    fi
    echo "  ↩ Retry ${attempts}/3 after 5s..."
    sleep 5
  done
}

publish_shaka() {
  mkdir -p "$(dirname "$SHAKA_SOURCE")"
  if [[ ! -f "$SHAKA_SOURCE" ]]; then
    echo "Fetching shaka-player@${SHAKA_VERSION}..."
    curl -fsSL "https://cdn.jsdelivr.net/npm/shaka-player@${SHAKA_VERSION}/dist/shaka-player.compiled.js" -o "$SHAKA_SOURCE"
  fi
  put_object "$SHAKA_KEY" "$SHAKA_SOURCE" "application/javascript; charset=utf-8"
  echo "  CDN: ${CDN_BASE}/${SHAKA_KEY}"
}

publish_web_deprecated() {
  echo "Web static is deployed with the Worker (same origin), not R2." >&2
  echo "Run: node scripts/sync-static-version.mjs && npx wrangler deploy" >&2
  exit 1
}

case "${1:-shaka}" in
  shaka|hls|all)
    publish_shaka
    ;;
  web)
    publish_web_deprecated
    ;;
  *)
    echo "Usage: $0 [shaka|web]" >&2
    exit 1
    ;;
esac

echo "Done."
