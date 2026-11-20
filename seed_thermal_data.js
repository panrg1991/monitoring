// 热成像造数脚本
// 用法: node seed_thermal_data.js [记录条数]
// 作用: 清空热成像相关表(点位温度 / 成像记录 / 报警阈值配置)后重新生成规整数据
const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = path.join(__dirname, 'mesmonitor.db');
const POINT_COUNT = 20;          // 点位数量
const RECORD_COUNT = Number(process.argv[2]) || 24; // 生成记录条数, 默认 24
const INTERVAL_MIN = 30;         // 相邻记录间隔(分钟)
const THRESHOLD_HIGH = 260;      // 报警上限(与前端色阶 >=260 红 保持一致)
const THRESHOLD_LOW = 0;

const rand = (min, max) => Math.random() * (max - min) + min;
const round1 = (v) => Math.round(v * 10) / 10;
const pad2 = (n) => String(n).padStart(2, '0');

// 本地时间字符串 YYYY-MM-DD HH:mm:ss
function fmt(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} `
    + `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
}

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// 1. 清空热成像相关表(子表 -> 父表)
db.exec(`
  DELETE FROM thermal_point_temps;
  DELETE FROM thermal_records;
  DELETE FROM thermal_alarm_config;
`);

// 自增序列归零, 让新数据 id 从 1 开始
const resetSeq = db.prepare("DELETE FROM sqlite_sequence WHERE name = ?");
for (const t of ['thermal_point_temps', 'thermal_records', 'thermal_alarm_config']) {
  try { resetSeq.run(t); } catch { /* 表无 sqlite_sequence 记录时忽略 */ }
}

// 2. 确保存在可用产品
let productId = db.prepare('SELECT id FROM products ORDER BY id LIMIT 1').get()?.id;
if (!productId) {
  productId = db.prepare(
    'INSERT INTO products (product_name, product_code, product_type, description) VALUES (?,?,?,?)'
  ).run('有色压铸3500T', 'PROD-P3500T', '压铸件', '热成像造数默认产品').lastInsertRowid;
}

// 3. 重写 20 个点位阈值配置
const insConfig = db.prepare(
  'INSERT INTO thermal_alarm_config (point_index, point_name, temp_high, temp_low, is_enabled) VALUES (?,?,?,?,1)'
);
for (let i = 1; i <= POINT_COUNT; i++) {
  insConfig.run(i, `点位${pad2(i)}`, THRESHOLD_HIGH, THRESHOLD_LOW);
}

// 4. 生成记录 + 点位温度
const insRecord = db.prepare(`
  INSERT INTO thermal_records
    (product_id, record_time, image_format, max_temp, min_temp, avg_temp, alarm_status, alarm_msg)
  VALUES (?,?,?,?,?,?,?,?)
`);
const insPoint = db.prepare(`
  INSERT INTO thermal_point_temps
    (record_id, point_name, point_index, temperature, pos_x, pos_y, is_alarm, alarm_threshold)
  VALUES (?,?,?,?,?,?,?,?)
`);

// 每个点位的基准温度(190~250), 让热力图有稳定的冷热分区
const baseTemps = Array.from({ length: POINT_COUNT }, () => rand(190, 250));

const now = new Date();
now.setSeconds(0, 0);

const run = db.transaction(() => {
  for (let r = 0; r < RECORD_COUNT; r++) {
    const time = new Date(now.getTime() - r * INTERVAL_MIN * 60 * 1000);
    const recordTime = fmt(time);

    // 整炉温度随记录时间缓慢波动
    const drift = Math.sin((r / RECORD_COUNT) * Math.PI * 2) * 8;

    const points = [];
    for (let i = 1; i <= POINT_COUNT; i++) {
      const temp = round1(
        Math.min(THRESHOLD_HIGH + 30, Math.max(THRESHOLD_LOW + 10, baseTemps[i - 1] + drift + rand(-6, 6)))
      );
      points.push({
        point_index: i,
        point_name: `点位${pad2(i)}`,
        temperature: temp,
        pos_x: 50 + ((i - 1) % 5) * 70,
        pos_y: 50 + Math.floor((i - 1) / 5) * 100,
        is_alarm: temp > THRESHOLD_HIGH ? 1 : 0,
      });
    }

    const temps = points.map((p) => p.temperature);
    const maxTemp = round1(Math.max(...temps));
    const minTemp = round1(Math.min(...temps));
    const avgTemp = round1(temps.reduce((s, v) => s + v, 0) / temps.length);
    const alarmPoints = points.filter((p) => p.is_alarm);
    const alarmStatus = alarmPoints.length
      ? (maxTemp >= THRESHOLD_HIGH + 20 ? 'critical' : 'warning')
      : 'normal';
    const alarmMsg = alarmPoints.length
      ? `${alarmPoints.map((p) => p.point_name).join('、')} 温度超过 ${THRESHOLD_HIGH}°C`
      : null;

    const recordId = insRecord.run(
      productId, recordTime, 'svg', maxTemp, minTemp, avgTemp, alarmStatus, alarmMsg
    ).lastInsertRowid;

    for (const p of points) {
      insPoint.run(
        recordId, p.point_name, p.point_index, p.temperature,
        p.pos_x, p.pos_y, p.is_alarm, THRESHOLD_HIGH
      );
    }
  }
});

run();

const summary = db.prepare(`
  SELECT COUNT(*) AS records,
         (SELECT COUNT(*) FROM thermal_point_temps) AS points,
         (SELECT MAX(record_time) FROM thermal_records) AS latest
  FROM thermal_records
`).get();

console.log('热成像数据重建完成');
console.log(`  记录数: ${summary.records}`);
console.log(`  点位温度记录数: ${summary.points}`);
console.log(`  最新记录时间: ${summary.latest}`);

db.close();
