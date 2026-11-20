// 测试基础设施：独立测试库 + 独立端口的服务实例
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const ROOT = path.resolve(__dirname, '..');
const TMP_DIR = path.join(__dirname, 'tmp');
const INIT_SQL = path.join(ROOT, 'init_all.sql');

function cleanupDbFiles(dbFile) {
  for (const f of [dbFile, `${dbFile}-wal`, `${dbFile}-shm`]) {
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
}

// 用 init_all.sql 建库，并灌入可预期的工艺数据（时间以当前时间为基准，便于验证「最近一个月」）
function createTestDb(dbFile, { processRows = 2000, daysBack = 6, intervalMinutes = 3 } = {}) {
  fs.mkdirSync(path.dirname(dbFile), { recursive: true });
  cleanupDbFiles(dbFile);

  const db = new Database(dbFile);
  db.pragma('journal_mode = WAL');
  db.exec(fs.readFileSync(INIT_SQL, 'utf8'));

  let device = db.prepare('SELECT id, device_code FROM devices ORDER BY id LIMIT 1').get();
  if (!device) {
    const id = db.prepare(
      'INSERT INTO devices (device_code, device_name, device_type, location) VALUES (?,?,?,?)'
    ).run('TEST-001', '测试压铸机', '压铸机', '测试车间').lastInsertRowid;
    device = { id, device_code: 'TEST-001' };
  }

  // 保证设备处于启用状态，统计口径才会包含种子数据
  db.prepare('UPDATE devices SET is_active = 1').run();

  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - daysBack);

  if (processRows > 0) {
    const insert = db.prepare(`
      INSERT INTO process_data
        (collect_time, device_code, product_model, batch_no, workpiece_no,
         slow_speed, fast_speed, cast_pressure, boost_pressure,
         pour_temp, mold_temp, cycle_time, hold_time, data_status, remark)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `);
    const base = start.getTime();
    const pad = (n) => String(n).padStart(2, '0');
    const fmt = (ts) => {
      const d = new Date(ts);
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} `
        + `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    };

    const tx = db.transaction(() => {
      for (let i = 0; i < processRows; i += 1) {
        const status = i % 50 === 0 ? 'unqualified' : (i % 12 === 0 ? 'warning' : 'normal');
        insert.run(
          fmt(base + i * intervalMinutes * 60 * 1000),
          device.device_code,
          'P3500T',
          `BATCH-${String(Math.floor(i / 200) + 1).padStart(3, '0')}`,
          `WP-${String(i + 1).padStart(5, '0')}`,
          0.18 + (i % 5) * 0.01,
          2.8 + (i % 7) * 0.02,
          84 + (i % 9) * 0.5,
          92 + (i % 11) * 0.4,
          670 + (i % 13),
          235 + (i % 7),
          58 + (i % 5) * 0.3,
          12 + (i % 3) * 0.2,
          status,
          i % 100 === 0 ? '=1+1 公式注入测试' : ''
        );
      }
    });
    tx();
  }

  const pad2 = (n) => String(n).padStart(2, '0');
  const dateStr = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

  db.close();
  return {
    dbFile,
    deviceCode: device.device_code,
    startDate: dateStr(start),
    endDate: dateStr(new Date()),
  };
}

function startServer({ port, dbFile, logFile, token = '', cors = '', maxBody = 1048576 }) {
  const child = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      DB_PATH: dbFile,
      LOG_FILE: logFile,
      ADMIN_TOKEN: token,
      CORS_ORIGIN: cors,
      MAX_BODY_BYTES: String(maxBody),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', () => {});
  child.stderr.on('data', () => {});
  return child;
}

async function waitReady(port, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/dashboard`);
      if (res.ok) return true;
    } catch {
      // 服务尚未监听
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`服务 ${port} 未在 ${timeoutMs}ms 内就绪`);
}

async function stopServer(child) {
  if (!child || child.exitCode !== null) return;
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch { /* 忽略 */ }
      resolve();
    }, 3000);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    child.kill();
  });
}

function url(port, p) {
  return `http://127.0.0.1:${port}${p}`;
}

async function getJson(port, p, headers = {}) {
  const res = await fetch(url(port, p), { headers });
  const text = await res.text();
  let body = null;
  try { body = JSON.parse(text); } catch { body = null; }
  return { status: res.status, headers: res.headers, body, text };
}

async function postJson(port, p, body, headers = {}) {
  const res = await fetch(url(port, p), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body || {}),
  });
  const text = await res.text();
  let parsed = null;
  try { parsed = JSON.parse(text); } catch { parsed = null; }
  return { status: res.status, headers: res.headers, body: parsed, text };
}

module.exports = {
  ROOT,
  TMP_DIR,
  createTestDb,
  startServer,
  stopServer,
  waitReady,
  getJson,
  postJson,
};
