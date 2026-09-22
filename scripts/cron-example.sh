#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd)"

# 仅输出适配当前项目位置的单账号 Cron 示例，不会修改 Crontab。
# 正式安装请优先运行 scripts/install-cron.sh。
SHELL=/bin/bash
CRON_TZ=Asia/Shanghai
PATH=/usr/local/bin:/usr/bin:/bin
printf 'SHELL=/bin/bash\n'
printf 'CRON_TZ=Asia/Shanghai\n'
printf 'PATH=/usr/local/bin:/usr/bin:/bin\n'
printf '0 0 * * * %q >> %q 2>&1\n' "${PROJECT_DIR}/scripts/run-daily-random.sh" "${PROJECT_DIR}/logs/cron.log"
