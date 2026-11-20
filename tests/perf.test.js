// 容量测试：10 万条工艺数据下的接口响应时间（审核清单「测试缺口」第 11 项）
// 运行：npm run test:perf
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  TMP_DIR,
  createTestDb,
  startServer,
  stopServer,
  waitReady,
  getJson,
} = require('./setup');

const PORT = Number(process.env.TEST_PORT_PERF) || 3989;
const ROWS = Number(process.env.PERF_ROWS) || 100000;

let server;
let info;

function ms(started) {
  return Number(process.hrtime.bigint() - started) / 1e6;
}

async function measure(urlPath, rounds = 2) {
  let best = Infinity;
  for (let i = 0; i < rounds; i += 1) {
    const started = process.hrtime.bigint();
    const res = await getJson(PORT, urlPath);
    const cost = ms(started);
    assert.equal(res.status, 200, `${urlPath} 返回 ${res.status}`);
    if (cost < best) best = cost;
  }
  return Number(best.toFixed(1));
}

test.before(async () => {
  fs.mkdirSync(TMP_DIR, { recursive: true });
  info = createTestDb(path.join(TMP_DIR, 'perf.db'), { processRows: ROWS, daysBack: 200 });
  server = startServer({
    port: PORT,
    dbFile: info.dbFile,
    logFile: path.join(TMP_DIR, 'perf.log'),
  });
  await waitReady(PORT, 30000);
});

test.after(async () => {
  await stopServer(server);
});

test(`11. ${ROWS} 条数据下核心接口响应时间在可接受范围`, async () => {
  const list = await measure('/api/process/data?pageSize=10');
  const lastPage = await measure('/api/process/data?page=5000&pageSize=10');
  const chart = await measure('/api/process/chart?params=pour_temp,mold_temp&limit=200');
  const analysis = await measure('/api/analysis/data?pageSize=10');
  const exportUrl = `/api/process/export?startTime=${info.startDate}&endTime=${info.endDate}`;
  const exportCost = await measure(exportUrl, 1);

  console.log(`  列表第 1 页: ${list} ms`);
  console.log(`  列表深分页: ${lastPage} ms`);
  console.log(`  曲线 200 点: ${chart} ms`);
  console.log(`  分析列表: ${analysis} ms`);
  console.log(`  导出 CSV: ${exportCost} ms`);

  assert.ok(list < 2000, `列表首页 ${list}ms 超出 2000ms`);
  assert.ok(lastPage < 5000, `深分页 ${lastPage}ms 超出 5000ms`);
  assert.ok(chart < 2000, `曲线接口 ${chart}ms 超出 2000ms`);
  assert.ok(analysis < 10000, `分析接口 ${analysis}ms 超出 10000ms`);
  assert.ok(exportCost < 30000, `导出 ${exportCost}ms 超出 30000ms`);

  // 导出应受 50000 行上限保护
  const csv = await getJson(PORT, exportUrl);
  const lines = csv.text.replace(/^\uFEFF/, '').trim().split(/\r?\n/);
  assert.ok(lines.length <= 50001, `导出未受上限约束：${lines.length} 行`);
});
