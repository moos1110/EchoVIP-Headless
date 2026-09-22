#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
BEGIN_MARKER="# BEGIN ECHOVIP MULTI ACCOUNT"
END_MARKER="# END ECHOVIP MULTI ACCOUNT"
LEGACY_BEGIN_MARKER="# BEGIN ECHOVIP HEADLESS"
LEGACY_END_MARKER="# END ECHOVIP HEADLESS"
CURRENT="$(crontab -l 2>/dev/null || true)"
CLEANED="$(printf '%s\n' "${CURRENT}" | awk \
  -v begin="${BEGIN_MARKER}" -v end="${END_MARKER}" \
  -v legacy_begin="${LEGACY_BEGIN_MARKER}" -v legacy_end="${LEGACY_END_MARKER}" '
  $0 == begin || $0 == legacy_begin { skip=1; next }
  $0 == end || $0 == legacy_end { skip=0; next }
  !skip { print }
')"

{
  printf '%s\n' "${CLEANED}"
  printf '%s\n' "${BEGIN_MARKER}"
  printf '%s\n' 'SHELL=/bin/bash'
  printf '%s\n' 'CRON_TZ=Asia/Shanghai'
  printf '%s\n' 'PATH=/usr/local/bin:/usr/bin:/bin'
  printf '* * * * * %q >> %q 2>&1\n' "${PROJECT_DIR}/scripts/run-scheduler-tick.sh" "${PROJECT_DIR}/control-data/scheduler-cron.log"
  printf '%s\n' "${END_MARKER}"
} | crontab -

echo "✅ EchoVIP 多账号调度已安装：每分钟检查一次，到达账号随机秒数时才运行原 claim 命令。"
