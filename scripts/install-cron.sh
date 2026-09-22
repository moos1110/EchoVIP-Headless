#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
runner="${project_dir}/scripts/run-daily-random.sh"
mkdir -p "${project_dir}/logs"
chmod +x "${runner}"

marker_begin="# BEGIN ECHOVIP HEADLESS"
marker_end="# END ECHOVIP HEADLESS"
existing="$(crontab -l 2>/dev/null || true)"
filtered="$(printf '%s\n' "${existing}" | sed "/${marker_begin}/,/${marker_end}/d")"
entry="${marker_begin}
SHELL=/bin/bash
CRON_TZ=Asia/Shanghai
PATH=/usr/local/bin:/usr/bin:/bin
0 0 * * * ${runner@Q} >> ${project_dir@Q}/logs/cron.log 2>&1
${marker_end}"

printf '%s\n%s\n' "${filtered}" "${entry}" | crontab -
echo "已安装每日 00:00 至 00:09:59（Asia/Shanghai）随机时间领取任务。"
