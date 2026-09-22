#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
docker_bin="${DOCKER_BIN:-$(command -v docker)}"
window_seconds="${ECHOVIP_RANDOM_WINDOW_SECONDS:-600}"

if [[ ! "${window_seconds}" =~ ^[1-9][0-9]*$ ]] || ((window_seconds > 600)); then
  echo "ECHOVIP_RANDOM_WINDOW_SECONDS 必须是 1 到 600 之间的整数。" >&2
  exit 2
fi

random_value="$(od -An -N4 -tu4 /dev/urandom | tr -d '[:space:]')"
delay_seconds=$((random_value % window_seconds))
scheduled_at="$(TZ=Asia/Shanghai date -d "+${delay_seconds} seconds" '+%Y-%m-%d %H:%M:%S %Z')"

echo "[$(TZ=Asia/Shanghai date '+%Y-%m-%d %H:%M:%S %Z')] 今日随机延迟 ${delay_seconds} 秒，计划 ${scheduled_at} 执行领取检查。"

if [[ "${1:-}" == "--dry-run" ]]; then
  exit 0
fi

sleep "${delay_seconds}"
cd "${project_dir}"
exec "${docker_bin}" compose run --rm -T echovip claim
