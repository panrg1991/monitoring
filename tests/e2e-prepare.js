// 浏览器端验证（XSS / 小屏适配）用的数据准备脚本
// 用法：node tests/e2e-prepare.js <dbFile>
// 会写入含 HTML payload 的字段，用于验证前端 v-html 已转义
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const { createTestDb } = require('./setup');

const dbFile = process.argv[2] || path.join(__dirname, 'tmp', 'e2e.db');
fs.mkdirSync(path.dirname(dbFile), { recursive: true });

const info = createTestDb(dbFile, { processRows: 300 });

const payload = '<img src=x onerror="window.__xss=(window.__xss||0)+1">';
const db = new Database(dbFile);

const andonType = db.prepare('SELECT id FROM andon_call_types ORDER BY id LIMIT 1').get();
if (andonType) {
  db.prepare('UPDATE andon_call_types SET type_icon = ? WHERE id = ?').run(payload, andonType.id);
}

db.prepare('UPDATE device_status SET alarm_info = ?').run(`告警 ${payload}`);

const device = db.prepare('SELECT id FROM devices ORDER BY id LIMIT 1').get();
if (device) {
  db.prepare('UPDATE devices SET description = ? WHERE id = ?').run(payload, device.id);
}

db.close();
console.log(JSON.stringify({ dbFile, deviceCode: info.deviceCode, startDate: info.startDate }));
