#!/usr/bin/env bash
# ============================================================
# MES Monitor 生产部署脚本（Linux）
#   1. 安装依赖 + 构建前端
#   2. 写入 systemd 服务并启动（常驻 API 服务）
#   3. 写入 crontab 定时任务（每小时重算昨天+今天）
#
# 用法（需 root / sudo）：
#   sudo bash deploy/linux/install.sh                  # 安装依赖、构建、装服务、装定时任务
#   sudo bash deploy/linux/install.sh --init-db        # 额外初始化数据库（会清空现有数据！）
#   sudo bash deploy/linux/install.sh --no-cron        # 不安装定时任务
#   sudo APP_DIR=/opt/mesmonitor RUN_USER=mes PORT=3456 bash deploy/linux/install.sh
#   sudo bash deploy/linux/install.sh --uninstall      # 停止并移除服务与定时任务
#
# 注意：stats_job.js 只是 HTTP 客户端，必须由 systemd 保证 server.js 常驻运行。
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="${APP_DIR:-$(cd "$SCRIPT_DIR/../.." && pwd)}"
SERVICE_NAME="${SERVICE_NAME:-mesmonitor}"
PORT="${PORT:-3456}"
RUN_USER="${RUN_USER:-${SUDO_USER:-$(id -un)}}"
CRON_SCHEDULE="${CRON_SCHEDULE:-10 * * * *}"
NODE_BIN="${NODE_BIN:-$(command -v node || true)}"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
CRON_TAG="# mesmonitor-stats-job"

INIT_DB=0
WITH_CRON=1
UNINSTALL=0

log() { echo "[mesmonitor] $*"; }
die() { echo "[mesmonitor] 错误：$*" >&2; exit 1; }

usage() {
  sed -n '2,17p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

for arg in "$@"; do
  case "$arg" in
    --init-db) INIT_DB=1 ;;
    --no-cron) WITH_CRON=0 ;;
    --uninstall) UNINSTALL=1 ;;
    -h|--help) usage; exit 0 ;;
    *) die "未知参数：$arg（使用 --help 查看用法）" ;;
  esac
done

[ "$(id -u)" -eq 0 ] || die "请用 root 或 sudo 运行：sudo bash deploy/linux/install.sh"
[ -d "$APP_DIR" ] || die "项目目录不存在：$APP_DIR"
[ -f "$APP_DIR/server.js" ] || die "$APP_DIR 不是项目目录（缺少 server.js）"

remove_cron() {
  if crontab -u "$RUN_USER" -l >/dev/null 2>&1; then
    crontab -u "$RUN_USER" -l | grep -F -v "$CRON_TAG" | crontab -u "$RUN_USER" - || true
    log "已移除定时任务（用户 $RUN_USER）"
  fi
}

# ---------- 卸载 ----------
if [ "$UNINSTALL" = "1" ]; then
  systemctl stop "$SERVICE_NAME" 2>/dev/null || true
  systemctl disable "$SERVICE_NAME" 2>/dev/null || true
  rm -f "$SERVICE_FILE"
  systemctl daemon-reload
  remove_cron
  log "服务 $SERVICE_NAME 与定时任务已移除（数据库与代码文件保留）"
  exit 0
fi

# ---------- 环境检查 ----------
[ -n "$NODE_BIN" ] || die "未找到 node，请先安装 Node.js 18+ 并加入 PATH"
NODE_MAJOR="$("$NODE_BIN" -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 18 ] || die "Node.js 版本过低（当前 $("$NODE_BIN" -v)），stats_job.js 需要 18+"

if [ "$RUN_USER" != "root" ] && ! id "$RUN_USER" >/dev/null 2>&1; then
  die "运行用户不存在：$RUN_USER（可用 RUN_USER=xxx 指定）"
fi

log "项目目录：$APP_DIR"
log "运行用户：$RUN_USER"
log "Node：$NODE_BIN ($("$NODE_BIN" -v))"
log "端口：$PORT"

# 以运行用户身份执行命令（保持 node 在 PATH 中）
run_as_user() {
  if [ "$RUN_USER" = "$(id -un)" ]; then
    bash -c "$1"
  else
    runuser -u "$RUN_USER" -- env "PATH=$PATH" "HOME=$(getent passwd "$RUN_USER" | cut -d: -f6)" bash -c "$1"
  fi
}

# ---------- 依赖与构建 ----------
log "安装依赖（npm ci / npm install）"
run_as_user "cd '$APP_DIR' && (npm ci --no-audit --no-fund || npm install --no-audit --no-fund)"

log "构建前端（npm run build）"
run_as_user "cd '$APP_DIR' && npm run build"
[ -f "$APP_DIR/dist/index.html" ] || die "构建失败：未生成 dist/index.html"

# ---------- 数据库 ----------
if [ "$INIT_DB" = "1" ]; then
  log "初始化数据库（会清空现有数据！）"
  TMP_JS="$(mktemp)"
  cat > "$TMP_JS" <<'NODE_EOF'
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const root = process.cwd();
const db = new Database(path.join(root, 'mesmonitor.db'));
db.exec(fs.readFileSync(path.join(root, 'init_all.sql'), 'utf8'));
db.close();
console.log('数据库初始化完成');
NODE_EOF
  chmod 644 "$TMP_JS"
  run_as_user "cd '$APP_DIR' && node '$TMP_JS'"
  rm -f "$TMP_JS"
fi
[ -f "$APP_DIR/mesmonitor.db" ] || log "提示：未发现 mesmonitor.db，首次启动前请执行 --init-db 初始化"

# ---------- systemd 服务 ----------
log "写入 systemd 服务：$SERVICE_FILE"
sed -e "s|__APP_DIR__|$APP_DIR|g" \
    -e "s|__RUN_USER__|$RUN_USER|g" \
    -e "s|__NODE_BIN__|$NODE_BIN|g" \
    -e "s|__PORT__|$PORT|g" \
    "$SCRIPT_DIR/mesmonitor.service" > "$SERVICE_FILE"

systemctl daemon-reload
systemctl enable "$SERVICE_NAME" >/dev/null
systemctl restart "$SERVICE_NAME"
sleep 2

if systemctl is-active --quiet "$SERVICE_NAME"; then
  log "服务已启动：systemctl status $SERVICE_NAME"
else
  systemctl --no-pager -l status "$SERVICE_NAME" || true
  die "服务启动失败，请查看上面输出或 $APP_DIR/server.stderr.log"
fi

# ---------- crontab ----------
if [ "$WITH_CRON" = "1" ]; then
  CRON_LINE="$CRON_SCHEDULE cd $APP_DIR && $NODE_BIN stats_job.js >/dev/null 2>&1 $CRON_TAG"
  { crontab -u "$RUN_USER" -l 2>/dev/null | grep -F -v "$CRON_TAG" || true; echo "$CRON_LINE"; } \
    | crontab -u "$RUN_USER" -
  log "已安装定时任务（$CRON_SCHEDULE，用户 $RUN_USER）：$CRON_LINE"
else
  log "已跳过定时任务（--no-cron）"
fi

cat <<EOF

部署完成。
  车间看板      http://<服务器IP>:$PORT/
  管理后台      http://<服务器IP>:$PORT/admin
  服务日志      journalctl -u $SERVICE_NAME -f
  应用日志      $APP_DIR/server.log
  任务日志      $APP_DIR/stats_job.log
  首次建历史     cd $APP_DIR && $NODE_BIN stats_job.js --all
  验证单次任务   cd $APP_DIR && $NODE_BIN stats_job.js --date \$(date +%F)
  注意：服务器时区需为 Asia/Shanghai，否则「昨天/今天」与班次归属会错位。
EOF
