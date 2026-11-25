/**
 * 生产统计定时任务
 * ------------------------------------------------------------
 * 调用后端 /api/stats/rebuild 重算「日期 + 班次 + 设备」的产量统计：
 *   · 数据源固定为工艺数据表 process_data，不使用任何模拟数据
 *   · 未配置班次时按天统计，配置班次后按班次统计（跨天班次归属开始日）
 *   · 只写入有来源记录的统计行，合计产量与 process_data 记录数一致
 *
 * 用法：
 *   node stats_job.js                      # 重算昨天 + 今天（推荐给计划任务调用）
 *   node stats_job.js --all                # 按 process_data 全部记录全量重建（清空后重算）
 *   node stats_job.js --days 7             # 重算最近 7 天（含今天）
 *   node stats_job.js --date 2026-11-17    # 重算指定某天
 *   node stats_job.js --from 2026-06-01 --to 2026-06-30   # 重算区间
 *   node stats_job.js --loop 600           # 常驻运行，每 600 秒重算一次
 *   node stats_job.js --port 3456 --host 127.0.0.1
 *
 * 说明：任务通过 HTTP 调用后端服务，需先启动 `node server.js`。
 *       Windows 计划任务示例见 README「生产统计定时任务」章节。
 */
const fs = require('fs');
const path = require('path');

const LOG_FILE = path.join(__dirname, 'stats_job.log');

function log(message) {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const ts = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ` +
    `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  const line = `[${ts}] ${message}`;
  console.log(line);
  try {
    fs.appendFileSync(LOG_FILE, line + '\n', 'utf-8');
  } catch {
    /* 日志写入失败不影响任务 */
  }
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function formatDate(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + n);
  return formatDate(date);
}

function parseArgs(argv) {
  const opts = {
    all: false, days: null, date: null, from: null, to: null, loop: 0, port: 3456, host: '127.0.0.1',
    // 机器令牌：服务端配置了 ADMIN_TOKEN 时必须携带（脚本无人值守，无需登录 Cookie）
    token: (process.env.ADMIN_TOKEN || '').trim(),
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => argv[i + 1];
    if (arg === '--all') { opts.all = true; }
    else if (arg === '--days') { opts.days = Number(next()); i += 1; }
    else if (arg === '--date') { opts.date = next(); i += 1; }
    else if (arg === '--from') { opts.from = next(); i += 1; }
    else if (arg === '--to') { opts.to = next(); i += 1; }
    else if (arg === '--loop') { opts.loop = Number(next()) || 60; i += 1; }
    else if (arg === '--port') { opts.port = Number(next()) || 3456; i += 1; }
    else if (arg === '--host') { opts.host = next() || '127.0.0.1'; i += 1; }
    else if (arg === '--token') { opts.token = String(next() || '').trim(); i += 1; }
  }
  return opts;
}

function resolveRange(opts) {
  const today = formatDate(new Date());
  if (opts.from || opts.to) {
    const from = opts.from || opts.to;
    const to = opts.to || opts.from;
    return { startDate: from, endDate: to };
  }
  if (opts.date) return { startDate: opts.date, endDate: opts.date };
  if (opts.days && opts.days > 0) {
    return { startDate: addDays(today, -(opts.days - 1)), endDate: today };
  }
  // 默认：昨天 + 今天（昨天补全，今天增量）
  return { startDate: addDays(today, -1), endDate: today };
}

async function runOnce(opts) {
  const range = opts.all ? { all: true } : resolveRange(opts);
  const scopeText = opts.all ? '全量' : `${range.startDate}~${range.endDate}`;
  const url = `http://${opts.host}:${opts.port}/api/stats/rebuild`;
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (opts.token) headers['X-Admin-Token'] = opts.token;
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(range),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      log(`统计失败 ${scopeText}：${data.error || 'HTTP ' + res.status}`);
      if (res.status === 401) {
        log('提示：服务已启用登录鉴权，请通过环境变量 ADMIN_TOKEN 或 --token 传入与服务端一致的机器令牌');
      }
      return false;
    }
    log(`统计完成 ${scopeText}（${data.startDate}~${data.endDate}）：模式=${data.mode === 'shift' ? '按班次' : '按天'}，` +
      `设备 ${data.deviceCount} 台，写入 ${data.rowCount} 行，来源记录 ${data.sourceRecords} 条`);
    return true;
  } catch (e) {
    log(`统计异常 ${scopeText}：${e.message}（请确认已启动 node server.js）`);
    return false;
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  log(`生产统计任务启动（host=${opts.host}, port=${opts.port}）`);

  if (!opts.loop) {
    const ok = await runOnce(opts);
    process.exit(ok ? 0 : 1);
  }

  log(`常驻模式：每 ${opts.loop} 秒重算一次，Ctrl+C 退出`);
  await runOnce(opts);

  // 上一次统计未结束时跳过本次，避免重复计算与统计表被并发重写
  let running = false;
  const tick = async () => {
    if (running) {
      log('上一次统计尚未结束，本次跳过');
      return;
    }
    running = true;
    try {
      await runOnce(opts);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(tick, opts.loop * 1000);
  timer.unref?.();

  const stop = () => {
    clearInterval(timer);
    log('生产统计任务已退出');
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main();
