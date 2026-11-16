#!/usr/bin/env bash
# 检查当前 GitHub 凭据能否推送
set -uo pipefail
OWNER="${1:-yiyucm}"
REPO="${2:-shiyuan}"
echo "▸ 探测写权限…"
code=$(curl -s -o /tmp/gh_probe.json -w "%{http_code}" \
  -X POST "https://api.github.com/user/repos" \
  -H "Accept: application/vnd.github+json" \
  -H "Authorization: Bearer ${GITHUB_TOKEN:-}" \
  -d "{\"name\":\"rp-perm-probe\",\"private\":true}" 2>/dev/null)
if [[ "$code" == "201" ]]; then
  echo "✅ 有写权限"
  curl -s -X DELETE "https://api.github.com/repos/${OWNER}/rp-perm-probe" \
    -H "Accept: application/vnd.github+json" \
    -H "Authorization: Bearer ${GITHUB_TOKEN:-}" >/dev/null
  echo "   （探测仓库已清理）"
elif [[ "$code" == "401" ]]; then
  echo "❌ token 无效"
elif [[ "$code" == "403" ]]; then
  echo "❌ token 缺少 repo scope（读权限有，写权限无）"
else
  echo "⚠️ 意外响应: $code"; head -c 200 /tmp/gh_probe.json; echo
fi
