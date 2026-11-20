#!/usr/bin/env bash
# 数据库热备份（SQLite 在线备份，不中断服务），默认保留 7 天
# 用法: ./deploy/backup.sh [数据库路径] [备份目录]
# 建议 crontab: 0 2 * * * /opt/mesmonitor/deploy/backup.sh >> /var/log/mesmonitor-backup.log 2>&1
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DB_FILE="${1:-$ROOT/mesmonitor.db}"
DEST_DIR="${2:-$ROOT/backup}"
KEEP_DAYS="${KEEP_DAYS:-7}"

if [ ! -f "$DB_FILE" ]; then
  echo "数据库不存在: $DB_FILE" >&2
  exit 1
fi

mkdir -p "$DEST_DIR"
STAMP="$(date +%Y%m%d_%H%M%S)"
TARGET="$DEST_DIR/mesmonitor_${STAMP}.db"

cd "$ROOT"
if command -v sqlite3 >/dev/null 2>&1; then
  sqlite3 "$DB_FILE" ".backup '$TARGET'"
else
  node -e "const D=require('better-sqlite3');const db=new D(process.argv[1],{readonly:true});db.backup(process.argv[2]).then(()=>{db.close();console.log('ok');}).catch(e=>{console.error(e);process.exit(1);});" "$DB_FILE" "$TARGET"
fi

echo "备份完成: $TARGET"

# 清理过期备份
find "$DEST_DIR" -name 'mesmonitor_*.db' -type f -mtime "+$KEEP_DAYS" -print -delete
