// 接口层自动化测试：覆盖审核清单「测试缺口」1-6、8-10 项
// 运行：npm test
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
  postJson,
} = require('./setup');

const PORT = Number(process.env.TEST_PORT) || 3987;
const PORT_AUTH = Number(process.env.TEST_PORT_AUTH) || 3988;
const TOKEN = 'test-token-123';

let main;        // 默认配置实例（无令牌、无跨域）
let auth;        // 启用令牌 + 跨域白名单的实例
let mainInfo;
let authInfo;

function qs(params) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') sp.set(k, String(v));
  }
  return sp.toString();
}

test.before(async () => {
  fs.mkdirSync(TMP_DIR, { recursive: true });

  mainInfo = createTestDb(path.join(TMP_DIR, 'api-main.db'), { processRows: 2000 });
  main = startServer({
    port: PORT,
    dbFile: mainInfo.dbFile,
    logFile: path.join(TMP_DIR, 'api-main.log'),
  });
  await waitReady(PORT);

  authInfo = createTestDb(path.join(TMP_DIR, 'api-auth.db'), { processRows: 200 });
  auth = startServer({
    port: PORT_AUTH,
    dbFile: authInfo.dbFile,
    logFile: path.join(TMP_DIR, 'api-auth.log'),
    token: TOKEN,
    cors: 'http://allowed.example',
  });
  await waitReady(PORT_AUTH);
});

test.after(async () => {
  await stopServer(main);
  await stopServer(auth);
});

test('1. 分页参数边界：page/pageSize 非法值被收敛到合法范围', async () => {
  const zero = await getJson(PORT, '/api/process/data?page=0&pageSize=0');
  assert.equal(zero.status, 200);
  assert.equal(zero.body.page, 1, 'page=0 应回落到第 1 页');
  assert.equal(zero.body.pageSize, 10, 'pageSize=0 应回落到默认 10');

  const negative = await getJson(PORT, '/api/process/data?page=-3&pageSize=-5');
  assert.equal(negative.body.page, 1);
  assert.equal(negative.body.pageSize, 1);
  assert.equal(negative.body.data.length, 1);

  const huge = await getJson(PORT, '/api/process/data?pageSize=1000000');
  assert.equal(huge.body.pageSize, 200, 'pageSize 上限应为 200');
  assert.equal(huge.body.data.length, 200);

  const text = await getJson(PORT, '/api/process/data?pageSize=abc&page=abc');
  assert.equal(text.body.pageSize, 10);
  assert.equal(text.body.page, 1);

  // 统计与计划列表同样受上限约束
  const stats = await getJson(PORT, '/api/stats/list?pageSize=1000000');
  assert.ok(stats.body.pageSize <= 200);
  const plans = await getJson(PORT, '/api/plans/list?pageSize=1000000');
  assert.ok(plans.body.pageSize <= 200);
});

test('2. 非法 id 不再 500，服务保持可用', async () => {
  const cases = [{ id: 'abc' }, { id: null }, { id: {} }, { id: '' }, {}];
  for (const body of cases) {
    const res = await postJson(PORT, '/api/plans/delete', body);
    assert.ok([400, 404].includes(res.status), `id=${JSON.stringify(body.id)} 应返回 400/404，实际 ${res.status}`);
    assert.ok(res.body && res.body.error);
  }
  const dev = await postJson(PORT, '/api/devices/delete', { id: 'abc' });
  assert.ok([400, 404].includes(dev.status));

  // 服务仍然存活
  const alive = await getJson(PORT, '/api/process/data?pageSize=1');
  assert.equal(alive.status, 200);
});

test('3. 导出：默认最近一个月、空区间只有表头、CSV 公式注入被转义', async () => {
  // 空区间：只有表头
  const empty = await getJson(PORT, `/api/process/export?${qs({ startTime: '2030-01-01', endTime: '2030-01-02' })}`);
  assert.equal(empty.status, 200);
  assert.match(empty.headers.get('content-type') || '', /text\/csv/);
  const emptyLines = empty.text.replace(/^\uFEFF/, '').trim().split(/\r?\n/);
  assert.equal(emptyLines.length, 1, '空区间只应返回表头');

  // 默认窗口（未传时间）= 最近一个月，应包含种子数据
  const def = await getJson(PORT, '/api/process/export');
  assert.equal(def.status, 200);
  assert.match(def.headers.get('content-disposition') || '', /\.csv/);
  const defLines = def.text.replace(/^\uFEFF/, '').trim().split(/\r?\n/);
  assert.ok(defLines.length > 1000, `默认一个月应导出全部种子数据，实际 ${defLines.length} 行`);
  // fetch 的 text() 会剥离 BOM，这里直接校验字节
  const rawCsv = await fetch(`http://127.0.0.1:${PORT}/api/process/export`);
  const rawBuf = Buffer.from(await rawCsv.arrayBuffer());
  assert.deepEqual([...rawBuf.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'CSV 应带 UTF-8 BOM');
  assert.match(defLines[0], /设备编号.*采集时间/);

  // 公式注入：以 = 开头的备注必须加单引号前缀
  assert.ok(def.text.includes("'=1+1"), '以 = 开头的单元格未做公式注入防护');
  assert.ok(!/\r\n=1\+1/.test(def.text), '存在未转义的公式单元格');

  // 统计 / 计划导出可用
  const stats = await getJson(PORT, `/api/stats/export?${qs({ startDate: mainInfo.startDate, endDate: mainInfo.endDate })}`);
  assert.equal(stats.status, 200);
  assert.match(stats.text, /统计日期/);
  const plans = await getJson(PORT, '/api/plans/export');
  assert.equal(plans.status, 200);
  assert.match(plans.text, /计划编号/);
});

test('4. 并发重新统计：两次请求都成功且结果一致，不出现半截数据', async () => {
  const deviceCode = mainInfo.deviceCode;
  const [a, b] = await Promise.all([
    postJson(PORT, '/api/stats/rebuild', { all: true }),
    postJson(PORT, '/api/stats/rebuild', { all: true }),
  ]);
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  assert.equal(a.body.success, true);
  assert.equal(b.body.success, true);
  assert.equal(a.body.total, b.body.total, '两次并发重建汇总应一致');

  const list = await getJson(PORT, `/api/stats/list?${qs({
    startDate: mainInfo.startDate,
    endDate: mainInfo.endDate,
    device: deviceCode,
    pageSize: 200,
  })}`);
  assert.equal(list.status, 200);
  assert.ok(list.body.total > 0, '统计表不应为空');
  assert.ok(list.body.summary.total > 0, '汇总数不应为 0（说明出现了半截数据）');
});

test('5. 启用令牌后：无令牌写接口 401，带令牌正常，GET 与导出不受影响', async () => {
  const noToken = await postJson(PORT_AUTH, '/api/plans/status', { id: 1, status: 'completed' });
  assert.equal(noToken.status, 401);
  assert.match(noToken.body.error, /未授权/);

  const wrong = await postJson(PORT_AUTH, '/api/plans/status', { id: 1, status: 'completed' }, { 'X-Admin-Token': 'wrong' });
  assert.equal(wrong.status, 401);

  const withToken = await postJson(PORT_AUTH, '/api/plans/status', { id: 1, status: 'completed' }, { 'X-Admin-Token': TOKEN });
  assert.notEqual(withToken.status, 401, '带正确令牌不应被鉴权拦截');

  const read = await getJson(PORT_AUTH, '/api/process/data?pageSize=1');
  assert.equal(read.status, 200, 'GET 接口不应要求令牌');

  const csv = await getJson(PORT_AUTH, '/api/process/export');
  assert.equal(csv.status, 200, '导出（GET）不应要求令牌');
});

test('6. 跨域默认不开放；配置白名单后只对白名单来源放行', async () => {
  const defaultPreflight = await fetch(`http://127.0.0.1:${PORT}/api/devices/delete`, {
    method: 'OPTIONS',
    headers: { Origin: 'http://evil.example', 'Access-Control-Request-Method': 'POST' },
  });
  assert.equal(defaultPreflight.status, 204);
  assert.equal(defaultPreflight.headers.get('access-control-allow-origin'), null, '默认不应返回跨域许可');

  const allowed = await fetch(`http://127.0.0.1:${PORT_AUTH}/api/devices/delete`, {
    method: 'OPTIONS',
    headers: { Origin: 'http://allowed.example', 'Access-Control-Request-Method': 'POST' },
  });
  assert.equal(allowed.headers.get('access-control-allow-origin'), 'http://allowed.example');
  assert.match(allowed.headers.get('access-control-allow-methods') || '', /POST/);

  const denied = await fetch(`http://127.0.0.1:${PORT_AUTH}/api/devices/delete`, {
    method: 'OPTIONS',
    headers: { Origin: 'http://evil.example', 'Access-Control-Request-Method': 'POST' },
  });
  assert.equal(denied.headers.get('access-control-allow-origin'), null, '非白名单来源不应获得跨域许可');
});

test('7. 请求体保护：超大 body 返回 413，非法 JSON 返回 400', async () => {
  const big = await fetch(`http://127.0.0.1:${PORT}/api/plans/status`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: 1, status: 'completed', pad: 'x'.repeat(2 * 1024 * 1024) }),
  });
  assert.equal(big.status, 413);

  const badJson = await fetch(`http://127.0.0.1:${PORT}/api/plans/status`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{not-json',
  });
  assert.equal(badJson.status, 400);

  const alive = await getJson(PORT, '/api/process/data?pageSize=1');
  assert.equal(alive.status, 200);
});

test('8. 计划状态机：非法流转被拒，合法流转被接受', async () => {
  const created = await postJson(PORT, '/api/plans/create', {
    device_code: mainInfo.deviceCode,
    plan_name: '状态机测试计划',
    product_model: 'P3500T',
    plan_count: 10,
    start_time: `${mainInfo.startDate} 00:00`,
    end_time: `${mainInfo.endDate} 23:59`,
  });
  assert.equal(created.status, 200, JSON.stringify(created.body));
  const id = created.body.plan.id;

  const toCompleted = await postJson(PORT, '/api/plans/status', { id, status: 'completed' });
  assert.equal(toCompleted.status, 200);
  assert.equal(toCompleted.body.plan.status, 'completed');

  // 已完成 → 进行中 / 已取消 都应被拒
  const backToRunning = await postJson(PORT, '/api/plans/status', { id, status: 'running' });
  assert.equal(backToRunning.status, 400, '已完成计划不应能恢复到进行中');
  const toCancelled = await postJson(PORT, '/api/plans/status', { id, status: 'cancelled' });
  assert.equal(toCancelled.status, 400, '已完成计划不应能取消');

  // 编辑接口不能绕过状态机改状态
  const edited = await postJson(PORT, '/api/plans/update', { id, status: 'running', plan_name: '状态机测试计划-改名' });
  assert.equal(edited.status, 200);
  assert.equal(edited.body.plan.status, 'completed', '编辑接口不应改变计划状态');

  // 新建计划：进行中 → 取消 → 恢复 合法
  const second = await postJson(PORT, '/api/plans/create', {
    device_code: mainInfo.deviceCode,
    plan_name: '状态机测试计划2',
    plan_count: 5,
    start_time: `${mainInfo.startDate} 00:00`,
    end_time: `${mainInfo.endDate} 23:59`,
  });
  const id2 = second.body.plan.id;
  assert.equal((await postJson(PORT, '/api/plans/status', { id: id2, status: 'cancelled' })).status, 200);
  assert.equal((await postJson(PORT, '/api/plans/status', { id: id2, status: 'running' })).status, 200);

  await postJson(PORT, '/api/plans/delete', { id });
  await postJson(PORT, '/api/plans/delete', { id: id2 });
});

test('9. 设备编号变更时工艺数据引用同步更新', async () => {
  const list = await getJson(PORT, '/api/devices/list');
  const devices = list.body.devices || [];
  const device = devices.find((d) => d.device_code === mainInfo.deviceCode);
  assert.ok(device, '应能查到种子设备');

  const newCode = `${mainInfo.deviceCode}-SYNC`;
  const updated = await postJson(PORT, '/api/devices/update', { id: device.id, device_code: newCode });
  assert.equal(updated.status, 200, JSON.stringify(updated.body));
  assert.ok(updated.body.syncedProcessRows > 0, '应同步更新工艺数据的设备编号');

  const moved = await getJson(PORT, `/api/process/data?${qs({ device: newCode, pageSize: 1 })}`);
  assert.ok(moved.body.total > 0, '新编号下应能查到原有工艺数据');
  const old = await getJson(PORT, `/api/process/data?${qs({ device: mainInfo.deviceCode, pageSize: 1 })}`);
  assert.equal(old.body.total, 0, '旧编号下不应再有数据');

  // 还原编号，避免影响后续用例
  const restored = await postJson(PORT, '/api/devices/update', { id: device.id, device_code: mainInfo.deviceCode });
  assert.equal(restored.status, 200);
});

test('10. 统计口径与工艺数据一致', async () => {
  await postJson(PORT, '/api/stats/rebuild', { all: true });
  const proc = await getJson(PORT, `/api/process/data?${qs({
    device: mainInfo.deviceCode,
    startTime: `${mainInfo.startDate} 00:00:00`,
    endTime: `${mainInfo.endDate} 23:59:59`,
    pageSize: 1,
  })}`);
  const stats = await getJson(PORT, `/api/stats/list?${qs({
    startDate: mainInfo.startDate,
    endDate: mainInfo.endDate,
    device: mainInfo.deviceCode,
    pageSize: 200,
  })}`);

  assert.equal(stats.status, 200);
  assert.equal(stats.body.summary.total, proc.body.total, '统计生产数应等于工艺记录数');
  assert.equal(
    stats.body.summary.total,
    stats.body.summary.qualified + stats.body.summary.warning + stats.body.summary.unqualified,
    '合格 + 预警 + 不合格 应等于生产总数'
  );
});

test('11. 产品档案可新增 / 修改 / 删除，被热成像引用时拒绝删除', async () => {
  const initial = await getJson(PORT, '/api/products/list');
  assert.equal(initial.status, 200);
  assert.equal(initial.body.total, 3, '初始化脚本应写入 3 个产品');
  assert.ok(initial.body.stats.total === 3);

  // 缺少名称
  const noName = await postJson(PORT, '/api/products/create', { product_code: 'PROD-NO-NAME' });
  assert.equal(noName.status, 400);

  // 正常新增
  const created = await postJson(PORT, '/api/products/create', {
    product_name: '测试产品-API',
    product_code: 'PROD-TEST-API',
    product_type: '测试类型',
    description: '自动化测试创建',
  });
  assert.equal(created.status, 200, JSON.stringify(created.body));
  const id = created.body.product.id;

  // 编码重复
  const dupCode = await postJson(PORT, '/api/products/create', {
    product_name: '测试产品-重码',
    product_code: 'PROD-TEST-API',
  });
  assert.equal(dupCode.status, 400);

  // 修改
  const updated = await postJson(PORT, '/api/products/update', {
    id,
    product_name: '测试产品-API-改',
    product_type: '测试类型2',
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.product.product_name, '测试产品-API-改');

  // 无关联时删除成功
  const deleted = await postJson(PORT, '/api/products/delete', { id });
  assert.equal(deleted.status, 200);

  // 已被热成像记录引用的产品（初始化数据 product_id = 1）禁止删除
  const used = await postJson(PORT, '/api/products/delete', { id: 1 });
  assert.equal(used.status, 400);
  assert.match(String(used.body.error), /热成像记录/);

  // 非法 id 不返回 500
  const badId = await postJson(PORT, '/api/products/delete', { id: 'abc' });
  assert.ok(badId.status === 404 || badId.status === 400);

  const options = await getJson(PORT, '/api/products/options');
  assert.equal(options.status, 200);
  assert.equal(options.body.length, 3, '删除测试产品后应回到 3 条');
});

test('12. 模具档案与配方通过 product_id / mold_id 关联，下拉数据可用', async () => {
  // 初始化数据的 4 条配方都应已关联产品档案
  const seeds = await getJson(PORT, '/api/recipes');
  assert.equal(seeds.status, 200);
  assert.equal(seeds.body.length, 4);
  seeds.body.forEach((r) => {
    assert.ok(r.product_id, `配方 ${r.id} 应回填 product_id`);
    assert.ok(r.product_code, `配方 ${r.id} 应能带出产品编码`);
    assert.ok(r.mold_name, `配方 ${r.id} 应能带出模具名称`);
  });

  // 下拉选项接口
  const opts = await getJson(PORT, '/api/recipes/options');
  assert.equal(opts.status, 200);
  assert.equal(opts.body.products.length, 3);
  assert.ok(opts.body.molds.length >= 4);
  assert.ok(Array.isArray(opts.body.lines) && opts.body.lines.length >= 1);

  // 模具档案 CRUD
  const moldList = await getJson(PORT, '/api/molds/list');
  assert.equal(moldList.body.total, 4);
  const noName = await postJson(PORT, '/api/molds/create', { mold_code: 'MOLD-TEST-API' });
  assert.equal(noName.status, 400);
  const createdMold = await postJson(PORT, '/api/molds/create', {
    mold_name: '测试模具-API',
    mold_code: 'MOLD-TEST-API',
    mold_type: '测试模',
  });
  assert.equal(createdMold.status, 200, JSON.stringify(createdMold.body));
  const moldId = createdMold.body.mold.id;

  const dupMoldCode = await postJson(PORT, '/api/molds/create', {
    mold_name: '测试模具-重码',
    mold_code: 'MOLD-TEST-API',
  });
  assert.equal(dupMoldCode.status, 400);

  // 配方必须选择产品
  const noProduct = await postJson(PORT, '/api/recipes/create', { mold_id: moldId });
  assert.equal(noProduct.status, 400);
  const badProduct = await postJson(PORT, '/api/recipes/create', { product_id: 999999 });
  assert.equal(badProduct.status, 400);
  const badMold = await postJson(PORT, '/api/recipes/create', { product_id: 1, mold_id: 999999 });
  assert.equal(badMold.status, 400);

  // 正常新增：产品名称由 products 档案带出
  const created = await postJson(PORT, '/api/recipes/create', {
    product_id: 1,
    mold_id: moldId,
    production_line: '测试线',
    fast1_enabled: '是',
    fast1_position: 66,
    boost_enabled: '1',
    boost_pressure: 88,
  });
  assert.equal(created.status, 200, JSON.stringify(created.body));
  const recipeId = created.body.recipe.id;

  const filtered = await getJson(PORT, `/api/recipes?${qs({ product_id: 1, mold_id: moldId })}`);
  assert.equal(filtered.body.length, 1);
  assert.equal(filtered.body[0].product_name, '有色压铸3500T');

  // 被配方引用时模具不可删除
  const blocked = await postJson(PORT, '/api/molds/delete', { id: moldId });
  assert.equal(blocked.status, 400);

  // 修改配方产品，冗余产品名称同步
  const updated = await postJson(PORT, '/api/recipes/update', { id: recipeId, product_id: 2 });
  assert.equal(updated.status, 200, JSON.stringify(updated.body));
  assert.equal(updated.body.recipe.product_name, '有色压铸5000T');

  // 清理：删除配方后模具可删
  assert.equal((await postJson(PORT, '/api/recipes/delete', { id: recipeId })).status, 200);
  assert.equal((await postJson(PORT, '/api/molds/delete', { id: moldId })).status, 200);
  const finalMolds = await getJson(PORT, '/api/molds/list');
  assert.equal(finalMolds.body.total, 4);
});

test('13. 配方分页查询与 CSV 导出', async () => {
  const first = await getJson(PORT, '/api/recipes/list?page=1&pageSize=2');
  assert.equal(first.status, 200);
  assert.equal(first.body.total, 4);
  assert.equal(first.body.page, 1);
  assert.equal(first.body.pageSize, 2);
  assert.equal(first.body.totalPages, 2);
  assert.equal(first.body.data.length, 2);

  const second = await getJson(PORT, '/api/recipes/list?page=2&pageSize=2');
  assert.equal(second.body.page, 2);
  assert.equal(second.body.data.length, 2);
  assert.notEqual(second.body.data[0].id, first.body.data[0].id);

  // 超出页码回落到最后一页
  const overflow = await getJson(PORT, '/api/recipes/list?page=99&pageSize=2');
  assert.equal(overflow.body.page, 2);

  // 分页接口同样支持产品筛选
  const byProduct = await getJson(PORT, '/api/recipes/list?product_id=1&pageSize=10');
  assert.equal(byProduct.body.total, 2);
  byProduct.body.data.forEach((r) => assert.equal(r.product_id, 1));

  // CSV 导出：带 BOM、表头正确、条数与筛选结果一致
  const csv = await getJson(PORT, '/api/recipes/export?product_id=1');
  assert.equal(csv.status, 200);
  assert.match(String(csv.headers.get('content-type')), /text\/csv/);
  assert.match(String(csv.headers.get('content-disposition')), /attachment/);
  const lines = csv.text.replace(/^\uFEFF/, '').trim().split('\r\n');
  assert.equal(lines.length, 3, '表头 + 2 条产品 1 的配方');
  assert.match(lines[0], /产品名称/);
  assert.match(lines[0], /增压压力\(MPa\)/);
  assert.match(lines[1], /有色压铸3500T/);
});
