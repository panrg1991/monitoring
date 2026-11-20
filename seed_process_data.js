/**
 * 工艺数据随机造数脚本
 * ------------------------------------------------------------
 * 用法:
 *   node seed_process_data.js [条数] [覆盖天数]
 * 示例:
 *   node seed_process_data.js            # 默认 10000 条, 覆盖近 180 天
 *   node seed_process_data.js 500 90     # 500 条, 覆盖近 90 天
 *
 * 说明:
 *   · 数据写入 process_data（全系统唯一数据源），分析模块自动可用
 *   · workpiece_no 全局唯一，重复执行不会产生重复编号
 *   · 参数值围绕各产品的标准值波动，data_status 按容差规则自动判定
 *     （偏差 ≤ 容差 normal，≤ 2 倍容差 warning，超出 unqualified）
 */
const path = require('path');
const Database = require('better-sqlite3');

const DB_FILE = path.join(__dirname, 'mesmonitor.db');
const COUNT = Math.max(1, parseInt(process.argv[2], 10) || 10000);
const DAYS = Math.max(1, parseInt(process.argv[3], 10) || 180);

const PARAM_KEYS = [
  'slow_speed', 'fast_speed', 'cast_pressure', 'boost_pressure',
  'pour_temp', 'mold_temp', 'cycle_time', 'hold_time',
  'injection_time', 'sprue_thickness', 'furnace_temp', 'goose_neck_temp',
  'nozzle_temp', 'oil_temp', 'fast_switch_point',
];

// 各产品基准值与容差、保留小数位
const PRODUCTS = [
  {
    model: 'P3500T',
    weight: 0.6,
    devices: ['YZJ-001', 'ZKJ-002', 'QJJ-005'],
    params: {
      slow_speed:     { base: 0.18, tol: 0.03, digits: 2 },
      fast_speed:     { base: 2.85, tol: 0.15, digits: 2 },
      cast_pressure:  { base: 85.0, tol: 3.0,  digits: 1 },
      boost_pressure: { base: 92.0, tol: 4.0,  digits: 1 },
      pour_temp:      { base: 680,  tol: 15,   digits: 0 },
      mold_temp:      { base: 245,  tol: 10,   digits: 0 },
      cycle_time:     { base: 58.0, tol: 3.0,  digits: 1 },
      hold_time:      { base: 12.5, tol: 1.0,  digits: 1 },
      injection_time: { base: 3.2,  tol: 0.3,  digits: 2 },
      sprue_thickness:{ base: 18.5, tol: 1.5,  digits: 1 },
      furnace_temp:   { base: 700,  tol: 20,   digits: 0 },
      goose_neck_temp:{ base: 660,  tol: 15,   digits: 0 },
      nozzle_temp:    { base: 640,  tol: 15,   digits: 0 },
      oil_temp:       { base: 45.0, tol: 5.0,  digits: 1 },
      fast_switch_point: { base: 320, tol: 20,  digits: 1 },
    },
  },
  {
    model: 'P5000T',
    weight: 0.25,
    devices: ['PWJ-003', 'ZKJ-002'],
    params: {
      slow_speed:     { base: 0.20, tol: 0.04, digits: 2 },
      fast_speed:     { base: 3.15, tol: 0.18, digits: 2 },
      cast_pressure:  { base: 92.5, tol: 3.5,  digits: 1 },
      boost_pressure: { base: 101.0, tol: 4.5, digits: 1 },
      pour_temp:      { base: 700,  tol: 18,   digits: 0 },
      mold_temp:      { base: 258,  tol: 12,   digits: 0 },
      cycle_time:     { base: 62.0, tol: 3.5,  digits: 1 },
      hold_time:      { base: 14.2, tol: 1.2,  digits: 1 },
      injection_time: { base: 3.6,  tol: 0.35, digits: 2 },
      sprue_thickness:{ base: 21.0, tol: 1.8,  digits: 1 },
      furnace_temp:   { base: 720,  tol: 22,   digits: 0 },
      goose_neck_temp:{ base: 678,  tol: 16,   digits: 0 },
      nozzle_temp:    { base: 655,  tol: 16,   digits: 0 },
      oil_temp:       { base: 48.0, tol: 5.0,  digits: 1 },
      fast_switch_point: { base: 350, tol: 22,  digits: 1 },
    },
  },
  {
    model: 'P2600T',
    weight: 0.15,
    devices: ['CXJ-004', 'PWJ-003'],
    params: {
      slow_speed:     { base: 0.16, tol: 0.03, digits: 2 },
      fast_speed:     { base: 2.50, tol: 0.14, digits: 2 },
      cast_pressure:  { base: 78.5, tol: 2.8,  digits: 1 },
      boost_pressure: { base: 84.2, tol: 3.8,  digits: 1 },
      pour_temp:      { base: 650,  tol: 15,   digits: 0 },
      mold_temp:      { base: 232,  tol: 10,   digits: 0 },
      cycle_time:     { base: 52.8, tol: 3.0,  digits: 1 },
      hold_time:      { base: 10.5, tol: 1.0,  digits: 1 },
      injection_time: { base: 2.8,  tol: 0.28, digits: 2 },
      sprue_thickness:{ base: 15.8, tol: 1.4,  digits: 1 },
      furnace_temp:   { base: 675,  tol: 18,   digits: 0 },
      goose_neck_temp:{ base: 638,  tol: 14,   digits: 0 },
      nozzle_temp:    { base: 620,  tol: 14,   digits: 0 },
      oil_temp:       { base: 43.0, tol: 4.5,  digits: 1 },
      fast_switch_point: { base: 295, tol: 18,  digits: 1 },
    },
  },
];

function rand(min, max) {
  return min + Math.random() * (max - min);
}

function gaussian() {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function pickProduct() {
  const r = Math.random();
  let acc = 0;
  for (const p of PRODUCTS) {
    acc += p.weight;
    if (r <= acc) return p;
  }
  return PRODUCTS[PRODUCTS.length - 1];
}

function pad(n, len = 2) {
  return String(n).padStart(len, '0');
}

function formatTime(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function formatDay(d) {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}

// 生成一行的参数值：先按容差范围轻微波动，再按目标等级注入偏差
function buildValues(product, level) {
  const values = {};
  for (const key of PARAM_KEYS) {
    const { base, tol, digits } = product.params[key];
    let v = base + gaussian() * (tol / 3.5);
    // 限制在 ±0.75 倍容差内，保证未注入偏差的参数处于正常区
    const maxDev = tol * 0.75;
    if (v > base + maxDev) v = base + maxDev;
    if (v < base - maxDev) v = base - maxDev;
    values[key] = Number(v.toFixed(digits));
  }

  if (level !== 'normal') {
    const hit = level === 'unqualified'
      ? [pick(PARAM_KEYS)]
      : Array.from(new Set([pick(PARAM_KEYS), pick(PARAM_KEYS)])).slice(0, 2);
    for (const key of hit) {
      const { base, tol, digits } = product.params[key];
      const sign = Math.random() < 0.5 ? -1 : 1;
      const factor = level === 'unqualified'
        ? rand(2.1, 4.2)
        : rand(1.05, 1.9);
      values[key] = Number((base + sign * tol * factor).toFixed(digits));
    }
  }
  return values;
}

// 按容差规则判定状态（与工艺/分析模块一致）
function judgeStatus(product, values) {
  let worst = 0;
  for (const key of PARAM_KEYS) {
    const { base, tol } = product.params[key];
    const diff = Math.abs(values[key] - base);
    let level = 0;
    if (diff > tol) level = diff <= tol * 2 ? 1 : 2;
    if (level > worst) worst = level;
  }
  return ['normal', 'warning', 'unqualified'][worst];
}

function pickLevel() {
  const r = Math.random();
  if (r < 0.82) return 'normal';
  if (r < 0.94) return 'warning';
  return 'unqualified';
}

const db = new Database(DB_FILE);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const insert = db.prepare(`
  INSERT OR IGNORE INTO process_data
    (collect_time, device_code, product_model, batch_no, workpiece_no,
     slow_speed, fast_speed, cast_pressure, boost_pressure,
     pour_temp, mold_temp, cycle_time, hold_time,
     injection_time, sprue_thickness, furnace_temp, goose_neck_temp,
     nozzle_temp, oil_temp, fast_switch_point, data_status)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const existing = db.prepare('SELECT id FROM process_data WHERE workpiece_no = ?');

const now = Date.now();
const startTs = now - DAYS * 24 * 60 * 60 * 1000;

// 生成时间戳并按时间升序，便于编号与阅读
const stamps = [];
for (let i = 0; i < COUNT; i += 1) {
  stamps.push(Math.floor(rand(startTs, now)));
}
stamps.sort((a, b) => a - b);

const stats = { normal: 0, warning: 0, unqualified: 0 };
let inserted = 0;
let skipped = 0;
let seq = 0;

const tx = db.transaction(() => {
  let lastDay = '';
  stamps.forEach((ts) => {
    const d = new Date(ts);
    const product = pickProduct();
    const device = pick(product.devices);
    const level = pickLevel();
    const values = buildValues(product, level);
    const status = judgeStatus(product, values);

    const day = formatDay(d);
    // 工件编号：WJ + 日期 + 6 位全局序列，保证唯一
    const workpieceNo = `WJ${day}${pad(seq, 6)}`;
    seq += 1;

    if (existing.get(workpieceNo)) {
      skipped += 1;
      return;
    }

    const batchNo = `B${day}${pad(PRODUCTS.indexOf(product) + 1, 2)}`;
    insert.run(
      formatTime(d), device, product.model, batchNo, workpieceNo,
      values.slow_speed, values.fast_speed, values.cast_pressure, values.boost_pressure,
      values.pour_temp, values.mold_temp, values.cycle_time, values.hold_time,
      values.injection_time, values.sprue_thickness, values.furnace_temp, values.goose_neck_temp,
      values.nozzle_temp, values.oil_temp, values.fast_switch_point, status
    );
    inserted += 1;
    stats[status] += 1;
    lastDay = day;
  });
});

const t0 = Date.now();
tx();
const cost = Date.now() - t0;

const summary = db.prepare(`
  SELECT COUNT(*) AS total, MIN(collect_time) AS min_time, MAX(collect_time) AS max_time
  FROM process_data
`).get();

console.log(`✅ 造数完成：本次写入 ${inserted} 条，跳过 ${skipped} 条，耗时 ${cost} ms`);
console.log(`   状态分布：正常 ${stats.normal} / 预警 ${stats.warning} / 不合格 ${stats.unqualified}`);
console.log(`   表内合计：${summary.total} 条，时间范围 ${summary.min_time} ~ ${summary.max_time}`);

db.close();
