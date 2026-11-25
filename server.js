const http = require('http');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// 数据库路径可通过 DB_PATH 覆盖（测试 / 多实例部署）
const DB_PATH = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : path.join(__dirname, 'mesmonitor.db');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const PORT = Number(process.env.PORT) || 3456;

// 机器令牌：设置后脚本可携带 X-Admin-Token 调用接口（等同超级管理员，用于曲线采集 / 定时统计等自动化任务）
const ADMIN_TOKEN = (process.env.ADMIN_TOKEN || '').trim();
// 跨域白名单：仅在配置后返回 CORS 头（默认同源部署，不开放跨域）
const CORS_ORIGIN = (process.env.CORS_ORIGIN || '').trim();
// 请求体与日志上限（非法 / 过小配置回落到默认值，避免误配导致所有写请求被拒）
const MAX_BODY_BYTES = Math.max(1024, Number(process.env.MAX_BODY_BYTES) || 1024 * 1024);
const LOG_MAX_BYTES = Math.max(1024, Number(process.env.LOG_MAX_BYTES) || 5 * 1024 * 1024);
// 历史数据保留天数：0 = 不清理（默认），仅清理日志 / 呼叫 / 统计派生表
const HISTORY_RETENTION_DAYS = Math.max(0, Number(process.env.HISTORY_RETENTION_DAYS) || 0);

// ==================== 登录与权限配置 ====================
const AUTH_COOKIE = 'mes_session';
// 会话有效期（小时）：默认 12，前端仅保存 HttpOnly Cookie，令牌不落 localStorage
const SESSION_TTL_HOURS = Math.max(1, Math.min(720, Number(process.env.SESSION_TTL_HOURS) || 12));
const DEFAULT_ADMIN_USER = (process.env.DEFAULT_ADMIN_USER || 'admin').trim() || 'admin';
// 初始超管密码：必须显式配置；未配置时首次建库随机生成并仅打印一次，避免默认弱口令
const CONFIGURED_ADMIN_PASSWORD = String(process.env.DEFAULT_ADMIN_PASSWORD || '').trim();
// 反向代理：默认不信任 X-Forwarded-For（否则攻击者可伪造 IP 绕过登录锁定）
const TRUST_PROXY = /^(1|true|yes|on)$/i.test(String(process.env.TRUST_PROXY || '').trim());
// HTTPS 部署时置 1，会话 Cookie 追加 Secure
const COOKIE_SECURE = /^(1|true|yes|on)$/i.test(String(process.env.COOKIE_SECURE || '').trim());
// 登录失败锁定：同一 IP + 用户名连续失败达到阈值后锁定一段时间
const LOGIN_MAX_FAILS = Math.max(3, Number(process.env.LOGIN_MAX_FAILS) || 5);
const LOGIN_LOCK_SECONDS = Math.max(10, Number(process.env.LOGIN_LOCK_SECONDS) || 60);
// 登录并发上限：scrypt 校验在 libuv 线程池执行，限制并发避免占满 CPU / 排队
const LOGIN_MAX_CONCURRENT = Math.max(1, Number(process.env.LOGIN_MAX_CONCURRENT) || 8);
let loginInFlight = 0;

// 车间看板（显示端）页面清单：可分配给用户
const DISPLAY_PAGES = [
  { key: 'home', label: '首页' },
  { key: 'thermal', label: '热成像' },
  { key: 'pipeline', label: '管路控制' },
  { key: 'recipe', label: '模具配方' },
  { key: 'andon', label: '安灯呼叫' },
  { key: 'process', label: '工艺数据' },
  { key: 'chart', label: '曲线分析' },
  { key: 'stats', label: '生产统计' },
  { key: 'plan', label: '生产计划' },
];

// 后台管理页面清单：可分配给用户
const ADMIN_PAGES = [
  { key: 'device', label: '设备管理' },
  { key: 'product', label: '产品管理' },
  { key: 'mold', label: '模具档案' },
  { key: 'recipe', label: '模具配方' },
  { key: 'pipeline', label: '管路控制' },
  { key: 'andon', label: '安灯呼叫' },
  { key: 'analysis', label: '数据分析' },
  { key: 'chart', label: '曲线分析' },
  { key: 'stats', label: '生产统计' },
  { key: 'plan', label: '生产计划' },
  { key: 'user', label: '用户权限' },
];

// 按钮级动作清单：按模块分组，前端据此渲染勾选项，后端据此校验写接口
const ACTION_CATALOG = [
  { key: 'device', label: '设备管理', actions: [{ key: 'create', label: '新增' }, { key: 'update', label: '修改' }, { key: 'delete', label: '删除' }] },
  { key: 'product', label: '产品管理', actions: [{ key: 'create', label: '新增' }, { key: 'update', label: '修改' }, { key: 'delete', label: '删除' }] },
  { key: 'mold', label: '模具档案', actions: [{ key: 'create', label: '新增' }, { key: 'update', label: '修改' }, { key: 'delete', label: '删除' }] },
  { key: 'recipe', label: '模具配方', actions: [{ key: 'create', label: '新增' }, { key: 'update', label: '修改' }, { key: 'delete', label: '删除' }] },
  { key: 'pipeline', label: '管路控制', actions: [{ key: 'update', label: '参数下发' }] },
  { key: 'andon', label: '安灯呼叫', actions: [{ key: 'create', label: '发起呼叫' }, { key: 'respond', label: '响应/完成' }] },
  { key: 'analysis', label: '数据分析', actions: [{ key: 'config', label: '标准配置' }] },
  { key: 'stats', label: '生产统计', actions: [{ key: 'config', label: '班次/重算' }] },
  { key: 'plan', label: '生产计划', actions: [{ key: 'create', label: '新建' }, { key: 'update', label: '修改' }, { key: 'delete', label: '删除' }, { key: 'operate', label: '开始/暂停/完成' }] },
  { key: 'user', label: '用户权限', actions: [{ key: 'create', label: '新增用户' }, { key: 'update', label: '修改用户' }, { key: 'delete', label: '删除用户' }] },
];

const DISPLAY_PAGE_KEYS = DISPLAY_PAGES.map((p) => p.key);
const ADMIN_PAGE_KEYS = ADMIN_PAGES.map((p) => p.key);
const ALL_ACTION_KEYS = ACTION_CATALOG.flatMap((m) => m.actions.map((a) => `${m.key}:${a.key}`));

// 写接口 → 所需动作权限（未列出的写接口仅要求登录）
const WRITE_API_PERMISSIONS = [
  { pattern: /^\/api\/devices\/(create)$/, module: 'device', action: 'create' },
  { pattern: /^\/api\/devices\/(update)$/, module: 'device', action: 'update' },
  { pattern: /^\/api\/devices\/(delete)$/, module: 'device', action: 'delete' },
  { pattern: /^\/api\/products\/(create)$/, module: 'product', action: 'create' },
  { pattern: /^\/api\/products\/(update)$/, module: 'product', action: 'update' },
  { pattern: /^\/api\/products\/(delete)$/, module: 'product', action: 'delete' },
  { pattern: /^\/api\/molds\/(create)$/, module: 'mold', action: 'create' },
  { pattern: /^\/api\/molds\/(update)$/, module: 'mold', action: 'update' },
  { pattern: /^\/api\/molds\/(delete)$/, module: 'mold', action: 'delete' },
  { pattern: /^\/api\/recipes\/(create)$/, module: 'recipe', action: 'create' },
  { pattern: /^\/api\/recipes\/(update)$/, module: 'recipe', action: 'update' },
  { pattern: /^\/api\/recipes\/(delete)$/, module: 'recipe', action: 'delete' },
  { pattern: /^\/api\/pipeline\/update$/, module: 'pipeline', action: 'update' },
  { pattern: /^\/api\/andon\/call$/, module: 'andon', action: 'create' },
  { pattern: /^\/api\/andon\/(respond|complete)$/, module: 'andon', action: 'respond' },
  { pattern: /^\/api\/analysis\/versions\/(create|update|delete)$/, module: 'analysis', action: 'config' },
  { pattern: /^\/api\/analysis\/standards\/(create|update|delete|reorder)$/, module: 'analysis', action: 'config' },
  { pattern: /^\/api\/stats\/shifts\/(create|update|delete|init)$/, module: 'stats', action: 'config' },
  { pattern: /^\/api\/stats\/rebuild$/, module: 'stats', action: 'config' },
  { pattern: /^\/api\/plans\/create$/, module: 'plan', action: 'create' },
  { pattern: /^\/api\/plans\/update$/, module: 'plan', action: 'update' },
  { pattern: /^\/api\/plans\/delete$/, module: 'plan', action: 'delete' },
  { pattern: /^\/api\/plans\/status$/, module: 'plan', action: 'operate' },
  { pattern: /^\/api\/auth\/users\/(create)$/, module: 'user', action: 'create' },
  { pattern: /^\/api\/auth\/users\/(update)$/, module: 'user', action: 'update' },
  { pattern: /^\/api\/auth\/users\/(delete)$/, module: 'user', action: 'delete' },
];

// 读接口 → 命中所属页面即可读取（任一命中即放行）
const READ_API_MODULES = [
  { prefix: '/api/devices', modules: ['device', 'home', 'stats'] },
  { prefix: '/api/products', modules: ['product', 'mold', 'recipe', 'plan', 'stats'] },
  { prefix: '/api/molds', modules: ['mold', 'recipe', 'plan', 'stats'] },
  { prefix: '/api/recipes', modules: ['recipe', 'plan'] },
  { prefix: '/api/pipeline', modules: ['pipeline'] },
  { prefix: '/api/andon', modules: ['andon', 'home'] },
  { prefix: '/api/thermal', modules: ['thermal', 'home'] },
  { prefix: '/api/process', modules: ['process', 'chart', 'analysis'] },
  { prefix: '/api/analysis', modules: ['analysis'] },
  { prefix: '/api/stats', modules: ['stats'] },
  { prefix: '/api/plans', modules: ['plan'] },
  { prefix: '/api/auth/users', modules: ['user'] },
];

// 无需登录即可访问的接口：健康检查 + 登录 + 会话查询 + 看板首页数据
const PUBLIC_API_PATHS = new Set([
  '/health',
  '/api/auth/login',
  '/api/auth/logout',
  '/api/auth/me',
  '/api/devices/overview',
  '/api/devices/alarm-log',
]);

// 登录失败计数：key = `${ip}|${username}`
const loginFailures = new Map();

// ==================== 数据源约定 ====================
// 工艺数据表 process_data 是全系统唯一的数据源：
//   · 工艺数据模块直接查询本表
//   · 历史工件分析模块不再单独存业务数据，同样查询本表
//   · 分析标准中出现的参数(param_key)必须是本表存在的工艺参数列
const PROCESS_META_COLUMNS = [
  'id', 'collect_time', 'device_code', 'product_model', 'batch_no',
  'workpiece_no', 'data_status', 'remark', 'created_at',
];

// 已知工艺参数的名称与单位（仅用于展示与新增标准时自动填充）
const PROCESS_PARAM_META = {
  slow_speed:       { name: '慢压射速度',   unit: 'm/s' },
  fast_speed:       { name: '快压射速度',   unit: 'm/s' },
  cast_pressure:    { name: '铸造压力',     unit: 'MPa' },
  boost_pressure:   { name: '增压压力',     unit: 'MPa' },
  pour_temp:        { name: '浇注温度',     unit: '℃'  },
  mold_temp:        { name: '模具温度',     unit: '℃'  },
  cycle_time:       { name: '循环周期',     unit: 's'   },
  hold_time:        { name: '保压时间',     unit: 's'   },
  injection_time:   { name: '压射时间',     unit: 's'   },
  sprue_thickness:  { name: '料柄厚度',     unit: 'mm'  },
  furnace_temp:     { name: '熔炉当前温度', unit: '℃'  },
  goose_neck_temp:  { name: '鹅颈当前温度', unit: '℃'  },
  nozzle_temp:      { name: '射嘴当前温度', unit: '℃'  },
  oil_temp:         { name: '当前油温',     unit: '℃'  },
  fast_switch_point:{ name: '高速切换点',   unit: 'mm'  },
};

function tableExists(name) {
  return !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name);
}

function tableColumns(name) {
  // 标识符白名单校验，避免表名拼接带来的注入风险
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return [];
  if (!tableExists(name)) return [];
  return db.prepare(`PRAGMA table_info(${name})`).all().map((c) => c.name);
}

// 工艺数据表中可作为分析参数的列
function processParamColumns() {
  return tableColumns('process_data').filter(c => !PROCESS_META_COLUMNS.includes(c));
}

// 可被分析标准引用的参数清单（key + 中文名 + 单位）
function processParamList() {
  return processParamColumns().map(key => ({
    param_key: key,
    param_name: (PROCESS_PARAM_META[key] && PROCESS_PARAM_META[key].name) || key,
    unit: (PROCESS_PARAM_META[key] && PROCESS_PARAM_META[key].unit) || '',
  }));
}

// ==================== 日志系统 ====================
const LOG_FILE = process.env.LOG_FILE
  ? path.resolve(process.env.LOG_FILE)
  : path.join(__dirname, 'server.log');

// 敏感字段名（命中则值打码）与单值最大长度
const SENSITIVE_KEYS = ['password', 'passwd', 'pwd', 'token', 'secret', 'authorization', 'cookie'];
const LOG_VALUE_MAX = 120;
let logWriteCount = 0;

function maskLogValue(key, value) {
  if (SENSITIVE_KEYS.some((k) => String(key).toLowerCase().includes(k))) return '***';
  if (value === null || value === undefined) return value;
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  return text.length > LOG_VALUE_MAX ? `${text.slice(0, LOG_VALUE_MAX)}…(len=${text.length})` : text;
}

function maskLogObject(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) out[k] = maskLogValue(k, v);
  return out;
}

// 日志超过上限时轮转一份 .1，避免无限增长写满磁盘
function rotateLogIfNeeded() {
  try {
    if (!fs.existsSync(LOG_FILE)) return;
    if (fs.statSync(LOG_FILE).size < LOG_MAX_BYTES) return;
    const backup = `${LOG_FILE}.1`;
    if (fs.existsSync(backup)) fs.unlinkSync(backup);
    fs.renameSync(LOG_FILE, backup);
  } catch {
    // 轮转失败不影响主流程
  }
}

function logWrite(level, message) {
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const timestamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  const line = `[${timestamp}] [${level}] ${message}\n`;
  logWriteCount += 1;
  if (logWriteCount % 200 === 1) rotateLogIfNeeded();
  // 异步写，避免同步 IO 阻塞请求
  fs.appendFile(LOG_FILE, line, 'utf-8', () => {});
  console.log(line.trim());
}

// 查询串脱敏：token / key / secret / password 等参数值打码后再落盘
function redactQueryString(query) {
  return String(query).replace(
    /([?&][^=&#]*(?:token|key|secret|password|passwd|pwd)[^=&#]*=)([^&#]*)/gi,
    '$1***'
  );
}

function logRequest(method, pathname, body) {
  const query = pathname.includes('?') ? pathname.slice(pathname.indexOf('?')) : '';
  let msg = `${method} ${pathname.replace(/\?.*$/, '')}`;
  if (body && typeof body === 'object' && Object.keys(body).length > 0) {
    msg += ` | body: ${JSON.stringify(maskLogObject(body))}`;
  }
  if (query) msg += ` | query${redactQueryString(query)}`;
  logWrite('REQUEST', msg);
}

function logResponse(method, pathname, status, summary) {
  const clean = pathname.replace(/\?.*$/, '');
  logWrite('RESPONSE', `${method} ${clean} => ${status}${summary ? ' | ' + summary : ''}`);
}

// MIME 类型映射
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.json': 'application/json; charset=utf-8',
};

// 静态资源安全响应头（防 MIME 嗅探 / 点击劫持 / 内容注入）
const STATIC_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'self'",
  ].join('; '),
};

// 拼接并校验路径，越出根目录（目录穿越）时返回 null
function safeJoin(rootDir, pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decoded.includes('\0') || decoded.includes('\\')) return null;
  const target = path.resolve(rootDir, `.${decoded}`);
  const rootPrefix = rootDir.endsWith(path.sep) ? rootDir : rootDir + path.sep;
  if (target !== rootDir && !target.startsWith(rootPrefix)) return null;
  return target;
}

function sendStaticFile(res, filePath) {
  const ext = path.extname(filePath);
  if (!MIME[ext]) return false;
  syncReadAndSend(res, filePath, MIME[ext]);
  return true;
}

function syncReadAndSend(res, filePath, contentType) {
  try {
    const content = fs.readFileSync(filePath);
    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': content.length,
      'Cache-Control': 'no-cache',
      ...STATIC_HEADERS,
    });
    res.end(content);
  } catch {
    sendNotFound(res);
  }
}

function sendNotFound(res) {
  res.writeHead(404, {
    'Content-Type': 'text/plain; charset=utf-8',
    ...STATIC_HEADERS,
  });
  res.end('Not Found');
}

// 静态文件服务：只从 dist（Vite 构建产物）读取，不暴露项目源码 / 配置文件
function serveStatic(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  let pathname = url.pathname;
  if (pathname === '/') pathname = '/index.html';
  // 管理端独立入口：/admin → dist/admin.html（显示端仍为 / → index.html）
  if (pathname === '/admin' || pathname === '/admin/') pathname = '/admin.html';

  const distRoot = path.join(__dirname, 'dist');
  const distPath = safeJoin(distRoot, pathname);
  if (distPath && fs.existsSync(distPath) && fs.statSync(distPath).isFile()) {
    if (sendStaticFile(res, distPath)) return;
  }

  // SPA 回退：仅对「无扩展名」的页面路由返回 dist/index.html，
  // 缺失的静态资源（.js / .json 等）一律 404，避免把源码或配置当页面返回
  if (!path.extname(pathname)) {
    const distIndex = path.join(distRoot, 'index.html');
    if (fs.existsSync(distIndex)) {
      syncReadAndSend(res, distIndex, MIME['.html']);
      return;
    }
  }

  sendNotFound(res);
}

// 健康检查：供负载均衡 / 监控探活，不依赖业务表
function healthCheck(req, res) {
  try {
    const ok = db.prepare('SELECT 1 AS ok').get();
    json(res, {
      status: 'ok',
      database: ok && ok.ok === 1 ? 'ok' : 'error',
      uptime: Math.round(process.uptime()),
      time: new Date().toISOString(),
    });
  } catch (err) {
    logWrite('ERROR', `健康检查失败: ${err && err.message}`);
    json(res, { status: 'error', database: 'error' }, 503);
  }
}

// ==================== 通用参数解析 ====================
const PAGE_SIZE_MAX = 200;
// 页码上限：防止 page=1e9 触发超大 OFFSET 全表扫描
const PAGE_MAX = 10000;

// 统一分页参数：page 限定 1 ~ 10000，pageSize 限定在 1 ~ 200，避免超大分页拖垮服务
function parsePaging(url, defaultSize = 10) {
  const page = Math.min(PAGE_MAX, Math.max(1, parseInt(url.searchParams.get('page'), 10) || 1));
  const rawSize = parseInt(url.searchParams.get('pageSize'), 10) || defaultSize;
  return { page, pageSize: Math.min(PAGE_SIZE_MAX, Math.max(1, rawSize)) };
}

// ==================== 入参校验工具 ====================
// 严格日历校验（含当月天数）：避免 2026-13-45 / 2026-02-31 写入业务表
function isValidDateParts(year, month, day) {
  if (!(year >= 1970 && year <= 2999)) return false;
  if (!(month >= 1 && month <= 12)) return false;
  if (!(day >= 1 && day <= 31)) return false;
  const dt = new Date(year, month - 1, day);
  return dt.getFullYear() === year && dt.getMonth() === month - 1 && dt.getDate() === day;
}

// 标量文本：对象 / 数组等非标量按空值处理，避免把 "[object Object]" 写进库
function toText(value) {
  if (value === null || value === undefined) return '';
  const type = typeof value;
  if (type === 'string') return value.trim();
  if (type === 'number' || type === 'boolean') return String(value);
  return '';
}

// 严格有限数字：空串 / NaN / Infinity 一律视为非法（返回 null）
function toFiniteNumber(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

// JSON 响应（带日志）
function json(res, data, status = 200) {
  let summary = '';
  if (typeof data === 'object' && data !== null) {
    if (Array.isArray(data)) {
      summary = `返回 ${data.length} 条`;
    } else if (data.total !== undefined) {
      summary = `共 ${data.total} 条，返回 ${data.data ? data.data.length : 0} 条`;
    } else if (data.success !== undefined) {
      summary = data.success ? '操作成功' : `操作失败: ${data.error || ''}`;
    } else {
      summary = `keys: ${Object.keys(data).join(',')}`;
    }
  }
  logResponse(res._reqMethod || 'GET', res._reqPath || '', status, summary);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(JSON.stringify(data));
}

// ==================== API 路由 ====================

// GET /api/devices/overview - 设备概览（统计 + 卡片）
function getDeviceOverview(req, res) {
  const stats = db.prepare(`
    SELECT
      COUNT(*) AS total,
      COALESCE(SUM(CASE WHEN latest_status='running' THEN 1 ELSE 0 END), 0) AS running,
      COALESCE(SUM(CASE WHEN latest_status='warning' THEN 1 ELSE 0 END), 0) AS warning,
      COALESCE(SUM(CASE WHEN latest_status='error'   THEN 1 ELSE 0 END), 0) AS error
    FROM (
      SELECT COALESCE(ds.status, 'running') AS latest_status
      FROM devices d
      LEFT JOIN device_status ds ON ds.id = (
        SELECT id FROM device_status WHERE device_id = d.id ORDER BY updated_at DESC, id DESC LIMIT 1
      )
      WHERE d.is_active = 1
    )
  `).get();

  const devices = db.prepare(`
    SELECT d.id, d.device_name, d.device_code, d.device_type, d.location,
           COALESCE(ds.status, 'running') AS status, ds.alarm_info, ds.detail_info
    FROM devices d
    LEFT JOIN device_status ds ON ds.id = (
      SELECT id FROM device_status WHERE device_id = d.id ORDER BY updated_at DESC, id DESC LIMIT 1
    )
    WHERE d.is_active = 1
    ORDER BY d.device_code
  `).all();

  json(res, { stats, devices });
}

// ==================== 设备管理模块（增删查改） ====================

// 设备表字段（用于新增 / 修改时白名单取值）
const DEVICE_EDITABLE_FIELDS = [
  'device_name', 'device_type', 'device_code', 'location',
  'model', 'manufacturer', 'install_date', 'description', 'is_active',
];

// 设备编号变更需要在事务内批量改写工艺数据/计划/统计，引用量过大时拒绝并引导迁移
const DEVICE_CODE_SYNC_MAX_ROWS = Math.max(1000, Number(process.env.DEVICE_CODE_SYNC_MAX_ROWS) || 20000);

function deviceUsageCount(deviceCode) {
  if (!deviceCode) return 0;
  return db.prepare('SELECT COUNT(*) AS cnt FROM process_data WHERE device_code = ?').get(deviceCode).cnt;
}

// 查询设备列表（含最新状态、关联工艺数据条数）
function getDeviceList(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const keyword = (url.searchParams.get('keyword') || '').trim();
  const type = (url.searchParams.get('type') || '').trim();
  const active = (url.searchParams.get('active') || '').trim();

  let where = 'WHERE 1=1';
  const params = [];
  if (keyword) {
    where += ' AND (d.device_name LIKE ? OR d.device_code LIKE ? OR d.location LIKE ?)';
    params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
  }
  if (type) { where += ' AND d.device_type = ?'; params.push(type); }
  if (active === '1' || active === '0') { where += ' AND d.is_active = ?'; params.push(Number(active)); }

  const devices = db.prepare(`
    SELECT d.*,
           CASE WHEN COALESCE(d.is_active, 0) = 1
                THEN COALESCE(ds.status, 'running')
                ELSE 'offline' END AS status,
           ds.alarm_info, ds.detail_info, ds.updated_at AS status_time,
           (SELECT COUNT(*) FROM process_data p WHERE p.device_code = d.device_code) AS process_count
    FROM devices d
    LEFT JOIN device_status ds ON ds.id = (
      SELECT id FROM device_status WHERE device_id = d.id ORDER BY updated_at DESC, id DESC LIMIT 1
    )
    ${where}
    ORDER BY COALESCE(d.is_active, 0) DESC, d.device_code
  `).all(...params);

  const total = devices.length;
  const stats = {
    total,
    running: devices.filter(d => d.status === 'running').length,
    warning: devices.filter(d => d.status === 'warning').length,
    error: devices.filter(d => d.status === 'error').length,
    active: devices.filter(d => Number(d.is_active) === 1).length,
    inactive: devices.filter(d => Number(d.is_active) !== 1).length,
  };
  const types = db.prepare('SELECT DISTINCT device_type FROM devices WHERE device_type IS NOT NULL ORDER BY device_type')
    .all().map(t => t.device_type);

  json(res, { total, stats, types, devices });
}

// 校验设备编码 / 名称唯一性
function validateDeviceUnique(code, name, excludeId) {
  if (code) {
    const dupCode = db.prepare('SELECT id FROM devices WHERE device_code = ? AND id <> ?').get(code, excludeId || 0);
    if (dupCode) return `设备编号 ${code} 已存在`;
  }
  if (name) {
    const dupName = db.prepare('SELECT id FROM devices WHERE device_name = ? AND id <> ?').get(name, excludeId || 0);
    if (dupName) return `设备名称 ${name} 已存在`;
  }
  return '';
}

// POST /api/devices/create - 新增设备
function createDevice(req, res, body) {
  const name = toText(body && body.device_name);
  const code = toText(body && body.device_code);
  const type = toText(body && body.device_type);
  if (!name) return json(res, { error: '缺少设备名称' }, 400);
  if (!code) return json(res, { error: '缺少设备编号' }, 400);
  if (!type) return json(res, { error: '缺少设备类型' }, 400);
  const dup = validateDeviceUnique(code, name, null);
  if (dup) return json(res, { error: dup }, 400);

  // 设备主表 + 初始状态 + 状态历史必须一起成功，避免留下没有状态的设备
  let newId = null;
  const tx = db.transaction(() => {
    const info = db.prepare(`
      INSERT INTO devices
        (device_name, device_type, device_code, location, model, manufacturer, install_date, description, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      name, type, code,
      toText(body.location),
      toText(body.model),
      toText(body.manufacturer),
      toText(body.install_date),
      toText(body.description),
      body.is_active == null ? 1 : (Number(body.is_active) ? 1 : 0)
    );
    newId = info.lastInsertRowid;

    // 新设备默认写入一条运行状态，保证首页监控可见
    db.prepare(`
      INSERT INTO device_status (device_id, status, alarm_info, detail_info)
      VALUES (?, 'running', '正常开机', '设备已新增')
    `).run(newId);
    db.prepare(`
      INSERT INTO device_status_history (device_id, status, alarm_info, detail_info, start_time)
      VALUES (?, 'running', '正常开机', '设备已新增', datetime('now','localtime'))
    `).run(newId);
  });
  tx();

  const record = db.prepare('SELECT * FROM devices WHERE id = ?').get(newId);
  json(res, { success: true, device: record });
}

// POST /api/devices/update - 修改设备
function updateDevice(req, res, body) {
  const id = Number(body && body.id);
  const device = Number.isSafeInteger(id) && id > 0
    ? db.prepare('SELECT * FROM devices WHERE id = ?').get(id)
    : null;
  if (!device) return json(res, { error: '设备不存在' }, 404);

  const next = { ...device };
  DEVICE_EDITABLE_FIELDS.forEach((field) => {
    if (body[field] === undefined || body[field] === null) return;
    next[field] = field === 'is_active'
      ? (Number(body[field]) ? 1 : 0)
      : toText(body[field]);
  });

  const name = toText(next.device_name);
  const code = toText(next.device_code);
  const type = toText(next.device_type);
  if (!name) return json(res, { error: '缺少设备名称' }, 400);
  if (!code) return json(res, { error: '缺少设备编号' }, 400);
  if (!type) return json(res, { error: '缺少设备类型' }, 400);
  const dup = validateDeviceUnique(code, name, id);
  if (dup) return json(res, { error: dup }, 400);

  let syncedRows = 0;
  let syncedPlanRows = 0;
  let syncedStatRows = 0;
  const oldCode = device.device_code;
  // 大批量同步会长时间持有写锁（单进程同步 SQLite 下全站阻塞），超阈值要求走迁移流程
  if (oldCode && code !== oldCode) {
    const used = deviceUsageCount(oldCode);
    if (used > DEVICE_CODE_SYNC_MAX_ROWS) {
      return json(res, {
        error: `该设备已有 ${used} 条工艺数据，修改编号会造成长时间锁库；请新建编号 ${code} 的设备并按需迁移数据`,
      }, 400);
    }
  }
  const tx = db.transaction(() => {
    // 设备编号变更时，同步所有按编号关联的表，避免出现孤立引用：
    // 工艺数据、生产计划（含执行段通过 plan_id 关联，无需改）、生产统计
    if (oldCode && code !== oldCode) {
      syncedRows = db.prepare('UPDATE process_data SET device_code = ? WHERE device_code = ?')
        .run(code, oldCode).changes;
      if (tableExists('production_plans')) {
        syncedPlanRows = db.prepare('UPDATE production_plans SET device_code = ? WHERE device_code = ?')
          .run(code, oldCode).changes;
      }
      if (tableExists('production_stats')) {
        syncedStatRows = db.prepare('UPDATE production_stats SET device_code = ? WHERE device_code = ?')
          .run(code, oldCode).changes;
      }
    }
    db.prepare(`
      UPDATE devices
      SET device_name = ?, device_type = ?, device_code = ?, location = ?,
          model = ?, manufacturer = ?, install_date = ?, description = ?,
          is_active = ?, updated_at = datetime('now','localtime')
      WHERE id = ?
    `).run(
      name, type, code,
      toText(next.location), toText(next.model), toText(next.manufacturer),
      toText(next.install_date), toText(next.description), Number(next.is_active) ? 1 : 0, id
    );
  });
  tx();

  const record = db.prepare('SELECT * FROM devices WHERE id = ?').get(id);
  json(res, {
    success: true,
    device: record,
    syncedProcessRows: syncedRows,
    syncedPlanRows,
    syncedStatRows,
  });
}

// POST /api/devices/delete - 删除设备
function deleteDevice(req, res, body) {
  const id = Number(body && body.id);
  const device = db.prepare('SELECT * FROM devices WHERE id = ?').get(id);
  if (!device) return json(res, { error: '设备不存在' }, 404);

  const used = deviceUsageCount(device.device_code);
  if (used > 0) {
    return json(res, {
      error: `设备 ${device.device_name}（${device.device_code}）已被 ${used} 条工艺数据引用，请先调整关联数据后再删除`,
    }, 400);
  }

  // 生产计划按设备编号关联，存在计划时禁止删除设备
  const planCount = tableExists('production_plans')
    ? db.prepare('SELECT COUNT(*) AS c FROM production_plans WHERE device_code = ?').get(device.device_code).c
    : 0;
  if (planCount > 0) {
    return json(res, {
      error: `设备 ${device.device_name}（${device.device_code}）已有 ${planCount} 条生产计划，请先删除相关计划后再删除设备`,
    }, 400);
  }

  const tx = db.transaction(() => {
    db.prepare('DELETE FROM device_status_history WHERE device_id = ?').run(id);
    db.prepare('DELETE FROM device_status WHERE device_id = ?').run(id);
    db.prepare('DELETE FROM devices WHERE id = ?').run(id);
  });
  tx();

  json(res, { success: true });
}

// GET /api/devices/options - 设备编号下拉选项（各页面筛选项统一取自设备管理表）
function getDeviceOptions(req, res) {
  json(res, deviceOptionList());
}

function deviceOptionList() {
  const rows = db.prepare(`
    SELECT device_code, device_name, device_type, is_active
    FROM devices
    WHERE device_code IS NOT NULL AND device_code <> ''
    ORDER BY COALESCE(is_active, 0) DESC, device_code
  `).all();
  const codes = new Set(rows.map(r => r.device_code));

  // 兼容：工艺数据中存在但设备表未登记的编号，也要能在筛选里选到
  const orphans = db.prepare(`
    SELECT DISTINCT device_code FROM process_data
    WHERE device_code IS NOT NULL AND device_code <> ''
  `).all();
  const extras = orphans
    .filter(o => !codes.has(o.device_code))
    .map(o => ({
      device_code: o.device_code,
      device_name: o.device_code,
      device_type: '未登记',
      is_active: 1,
    }));

  // 未登记编号视同启用：与已登记设备统一按「启用优先、编号升序」排序
  return rows.concat(extras).sort((a, b) => {
    const rank = (item) => (Number(item.is_active) === 1 ? 0 : 1);
    if (rank(a) !== rank(b)) return rank(a) - rank(b);
    return String(a.device_code).localeCompare(String(b.device_code));
  });
}

// GET /api/devices/alarm-log - 按设备名称查报警
function getDeviceAlarmByName(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const name = url.searchParams.get('name');
  if (!name) return json(res, { error: '缺少设备名称' }, 400);

  const device = db.prepare('SELECT id, device_name FROM devices WHERE device_name = ?').get(name);
  if (!device) return json(res, { error: '设备不存在' }, 404);

  const logs = db.prepare(`
    SELECT start_time AS time, alarm_info AS message, detail_info
    FROM device_status_history
    WHERE device_id = ?
    ORDER BY start_time DESC
    LIMIT 20
  `).all(device.id);

  json(res, { device_name: device.device_name, logs });
}

// ==================== 产品基础数据模块（增删查改） ====================
// products 是热成像记录（thermal_records.product_id）的产品档案，
// 产品名称 / 编码 / 类型等基础信息统一在此维护，热成像记录只引用产品 id。

const PRODUCT_EDITABLE_FIELDS = ['product_name', 'product_code', 'product_type', 'description'];

// 空编码统一存 NULL，避免多个产品共用空串触发 UNIQUE 约束
function normalizeProductCode(code) {
  const text = String(code == null ? '' : code).trim();
  return text === '' ? null : text;
}

function productUsageCount(productId) {
  if (!productId || !tableExists('thermal_records')) return 0;
  return db.prepare('SELECT COUNT(*) AS cnt FROM thermal_records WHERE product_id = ?').get(productId).cnt;
}

// 校验产品编码 / 名称唯一性（名称也要求唯一，避免产品档案重复）
function validateProductUnique(code, name, excludeId) {
  const selfId = excludeId || 0;
  if (code) {
    const dupCode = db.prepare('SELECT id FROM products WHERE product_code = ? AND id <> ?').get(code, selfId);
    if (dupCode) return `产品编码 ${code} 已存在`;
  }
  if (name) {
    const dupName = db.prepare('SELECT id FROM products WHERE product_name = ? AND id <> ?').get(name, selfId);
    if (dupName) return `产品名称 ${name} 已存在`;
  }
  return '';
}

// GET /api/products/list - 产品列表（含热成像记录引用数）
function getProductList(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const keyword = (url.searchParams.get('keyword') || '').trim();
  const type = (url.searchParams.get('type') || '').trim();

  let where = 'WHERE 1=1';
  const params = [];
  if (keyword) {
    where += ' AND (p.product_name LIKE ? OR p.product_code LIKE ? OR p.description LIKE ?)';
    params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
  }
  if (type) { where += ' AND p.product_type = ?'; params.push(type); }

  const usageExpr = tableExists('thermal_records')
    ? '(SELECT COUNT(*) FROM thermal_records t WHERE t.product_id = p.id)'
    : '0';
  const products = db.prepare(`
    SELECT p.*, ${usageExpr} AS thermal_count
    FROM products p
    ${where}
    ORDER BY p.id
  `).all(...params);

  const types = db.prepare(
    "SELECT DISTINCT product_type FROM products WHERE product_type IS NOT NULL AND product_type <> '' ORDER BY product_type"
  ).all().map((row) => row.product_type);

  const total = products.length;
  const used = products.filter((p) => Number(p.thermal_count) > 0).length;
  json(res, {
    total,
    stats: { total, used, unused: total - used, typeCount: types.length },
    types,
    products,
  });
}

// GET /api/products/options - 产品下拉选项
function getProductOptions(req, res) {
  const rows = db.prepare('SELECT id, product_name, product_code FROM products ORDER BY id').all();
  json(res, rows);
}

// POST /api/products/create - 新增产品
function createProduct(req, res, body) {
  const payload = body || {};
  const name = String(payload.product_name || '').trim();
  if (!name) return json(res, { error: '缺少产品名称' }, 400);
  const code = normalizeProductCode(payload.product_code);
  const dup = validateProductUnique(code, name, null);
  if (dup) return json(res, { error: dup }, 400);

  const info = db.prepare(`
    INSERT INTO products (product_name, product_code, product_type, description)
    VALUES (?, ?, ?, ?)
  `).run(
    name,
    code,
    String(payload.product_type || '').trim(),
    String(payload.description || '').trim()
  );

  const record = db.prepare('SELECT * FROM products WHERE id = ?').get(info.lastInsertRowid);
  logWrite('PRODUCT', `新增产品：${name}${code ? `（${code}）` : ''}`);
  json(res, { success: true, product: record });
}

// POST /api/products/update - 修改产品
function updateProduct(req, res, body) {
  const payload = body || {};
  const id = Number(payload.id);
  const product = Number.isInteger(id) && id > 0
    ? db.prepare('SELECT * FROM products WHERE id = ?').get(id)
    : null;
  if (!product) return json(res, { error: '产品不存在' }, 404);

  const next = { ...product };
  PRODUCT_EDITABLE_FIELDS.forEach((field) => {
    if (payload[field] === undefined || payload[field] === null) return;
    next[field] = field === 'product_code'
      ? normalizeProductCode(payload[field])
      : String(payload[field]).trim();
  });

  const name = String(next.product_name || '').trim();
  if (!name) return json(res, { error: '缺少产品名称' }, 400);
  const code = normalizeProductCode(next.product_code);
  const dup = validateProductUnique(code, name, id);
  if (dup) return json(res, { error: dup }, 400);

  db.prepare(`
    UPDATE products
    SET product_name = ?, product_code = ?, product_type = ?, description = ?,
        updated_at = datetime('now','localtime')
    WHERE id = ?
  `).run(name, code, next.product_type || '', next.description || '', id);

  const record = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
  logWrite('PRODUCT', `修改产品：${name}（id=${id}）`);
  json(res, { success: true, product: record });
}

// POST /api/products/delete - 删除产品（被热成像记录引用时拒绝）
function deleteProduct(req, res, body) {
  const payload = body || {};
  const id = Number(payload.id);
  const product = Number.isInteger(id) && id > 0
    ? db.prepare('SELECT * FROM products WHERE id = ?').get(id)
    : null;
  if (!product) return json(res, { error: '产品不存在' }, 404);

  const used = productUsageCount(id);
  if (used > 0) {
    return json(res, {
      error: `产品 ${product.product_name} 已被 ${used} 条热成像记录引用，请先处理关联记录后再删除`,
    }, 400);
  }

  db.prepare('DELETE FROM products WHERE id = ?').run(id);
  logWrite('PRODUCT', `删除产品：${product.product_name}（id=${id}）`);
  json(res, { success: true });
}

// ==================== 热成像模块 ====================

// GET /api/thermal/config - 热成像点位配置
function getThermalConfig(req, res) {
  const configs = db.prepare('SELECT * FROM thermal_alarm_config ORDER BY point_index').all();
  json(res, configs);
}

// GET /api/thermal/latest - 最新热成像记录
function getThermalLatest(req, res) {
  const record = db.prepare(`
    SELECT tr.*, p.product_name
    FROM thermal_records tr
    LEFT JOIN products p ON p.id = tr.product_id
    ORDER BY tr.record_time DESC LIMIT 1
  `).get();

  if (!record) {
    // 无记录时返回默认点位温度（阈值取自 thermal_alarm_config）
    const cfgMap = new Map(
      db.prepare('SELECT point_index, temp_high, temp_low FROM thermal_alarm_config').all()
        .map((c) => [c.point_index, c])
    );
    const defaults = [];
    for (let i = 1; i <= 20; i++) {
      const cfg = cfgMap.get(i) || {};
      defaults.push({
        point_name: `点位${String(i).padStart(2, '0')}`,
        point_index: i,
        temperature: (68 + Math.random() * 7).toFixed(1),
        temp_high: cfg.temp_high ?? null,
        temp_low: cfg.temp_low ?? null,
      });
    }
    return json(res, { record: null, points: defaults });
  }

  // 点位温度关联报警阈值配置（前端按 temp_high / temp_low 决定颜色）
  const points = db.prepare(`
    SELECT t.*, c.temp_high, c.temp_low, c.is_enabled AS config_enabled
    FROM thermal_point_temps t
    LEFT JOIN thermal_alarm_config c ON c.point_index = t.point_index
    WHERE t.record_id = ?
    ORDER BY t.point_index
  `).all(record.id);
  json(res, { record, points: points.length > 0 ? points : [] });
}

// ==================== 模具档案模块（增删查改） ====================
// molds 是模具基础档案，mold_recipes.mold_id 引用本表；
// 配方中的产品同样以 product_id 引用 products，避免自由文本造成的名称漂移。

const MOLD_EDITABLE_FIELDS = ['mold_name', 'mold_code', 'mold_type', 'description', 'is_active'];

function moldNormalizeCode(code) {
  const text = String(code == null ? '' : code).trim();
  return text === '' ? null : text;
}

function moldUsageCount(moldId) {
  if (!moldId || !tableExists('mold_recipes')) return 0;
  return db.prepare('SELECT COUNT(*) AS cnt FROM mold_recipes WHERE mold_id = ?').get(moldId).cnt;
}

function validateMoldUnique(code, name, excludeId) {
  const selfId = excludeId || 0;
  if (code) {
    const dupCode = db.prepare('SELECT id FROM molds WHERE mold_code = ? AND id <> ?').get(code, selfId);
    if (dupCode) return `模具编码 ${code} 已存在`;
  }
  if (name) {
    const dupName = db.prepare('SELECT id FROM molds WHERE mold_name = ? AND id <> ?').get(name, selfId);
    if (dupName) return `模具名称 ${name} 已存在`;
  }
  return '';
}

// GET /api/molds/list - 模具档案列表（含配方引用数）
function getMoldList(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const keyword = (url.searchParams.get('keyword') || '').trim();
  const type = (url.searchParams.get('type') || '').trim();
  const active = (url.searchParams.get('active') || '').trim();

  let where = 'WHERE 1=1';
  const params = [];
  if (keyword) {
    where += ' AND (m.mold_name LIKE ? OR m.mold_code LIKE ? OR m.description LIKE ?)';
    params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
  }
  if (type) { where += ' AND m.mold_type = ?'; params.push(type); }
  if (active === '1' || active === '0') { where += ' AND m.is_active = ?'; params.push(Number(active)); }

  const usageExpr = tableExists('mold_recipes')
    ? '(SELECT COUNT(*) FROM mold_recipes r WHERE r.mold_id = m.id)'
    : '0';
  const molds = db.prepare(`
    SELECT m.*, ${usageExpr} AS recipe_count
    FROM molds m
    ${where}
    ORDER BY COALESCE(m.is_active, 0) DESC, m.id
  `).all(...params);

  const types = db.prepare(
    "SELECT DISTINCT mold_type FROM molds WHERE mold_type IS NOT NULL AND mold_type <> '' ORDER BY mold_type"
  ).all().map((row) => row.mold_type);

  const total = molds.length;
  const used = molds.filter((m) => Number(m.recipe_count) > 0).length;
  json(res, {
    total,
    stats: {
      total,
      used,
      unused: total - used,
      inactive: molds.filter((m) => Number(m.is_active) !== 1).length,
    },
    types,
    molds,
  });
}

// GET /api/molds/options - 模具下拉选项（仅启用模具，未启用不参与新配方选择）
function getMoldOptions(req, res) {
  const rows = db.prepare(`
    SELECT id, mold_name, mold_code, mold_type
    FROM molds
    WHERE is_active = 1
    ORDER BY mold_name
  `).all();
  json(res, rows);
}

// POST /api/molds/create - 新增模具
function createMold(req, res, body) {
  const payload = body || {};
  const name = String(payload.mold_name || '').trim();
  if (!name) return json(res, { error: '缺少模具名称' }, 400);
  const code = moldNormalizeCode(payload.mold_code);
  const dup = validateMoldUnique(code, name, null);
  if (dup) return json(res, { error: dup }, 400);

  const info = db.prepare(`
    INSERT INTO molds (mold_name, mold_code, mold_type, description, is_active)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    name,
    code,
    String(payload.mold_type || '').trim(),
    String(payload.description || '').trim(),
    payload.is_active == null ? 1 : (Number(payload.is_active) ? 1 : 0)
  );

  const record = db.prepare('SELECT * FROM molds WHERE id = ?').get(info.lastInsertRowid);
  logWrite('MOLD', `新增模具：${name}${code ? `（${code}）` : ''}`);
  json(res, { success: true, mold: record });
}

// POST /api/molds/update - 修改模具
function updateMold(req, res, body) {
  const payload = body || {};
  const id = Number(payload.id);
  const mold = Number.isInteger(id) && id > 0
    ? db.prepare('SELECT * FROM molds WHERE id = ?').get(id)
    : null;
  if (!mold) return json(res, { error: '模具不存在' }, 404);

  const next = { ...mold };
  MOLD_EDITABLE_FIELDS.forEach((field) => {
    if (payload[field] === undefined || payload[field] === null) return;
    if (field === 'is_active') { next[field] = Number(payload[field]) ? 1 : 0; return; }
    next[field] = field === 'mold_code'
      ? moldNormalizeCode(payload[field])
      : String(payload[field]).trim();
  });

  const name = String(next.mold_name || '').trim();
  if (!name) return json(res, { error: '缺少模具名称' }, 400);
  const code = moldNormalizeCode(next.mold_code);
  const dup = validateMoldUnique(code, name, id);
  if (dup) return json(res, { error: dup }, 400);

  db.prepare(`
    UPDATE molds
    SET mold_name = ?, mold_code = ?, mold_type = ?, description = ?,
        is_active = ?, updated_at = datetime('now','localtime')
    WHERE id = ?
  `).run(name, code, next.mold_type || '', next.description || '', Number(next.is_active) ? 1 : 0, id);

  const record = db.prepare('SELECT * FROM molds WHERE id = ?').get(id);
  logWrite('MOLD', `修改模具：${name}（id=${id}）`);
  json(res, { success: true, mold: record });
}

// POST /api/molds/delete - 删除模具（被配方引用时拒绝）
function deleteMold(req, res, body) {
  const payload = body || {};
  const id = Number(payload.id);
  const mold = Number.isInteger(id) && id > 0
    ? db.prepare('SELECT * FROM molds WHERE id = ?').get(id)
    : null;
  if (!mold) return json(res, { error: '模具不存在' }, 404);

  const used = moldUsageCount(id);
  if (used > 0) {
    return json(res, {
      error: `模具 ${mold.mold_name} 已被 ${used} 条配方引用，请先调整配方后再删除`,
    }, 400);
  }

  db.prepare('DELETE FROM molds WHERE id = ?').run(id);
  logWrite('MOLD', `删除模具：${mold.mold_name}（id=${id}）`);
  json(res, { success: true });
}

// ==================== 模具配方模块 ====================

// 配方可写字段：产品 / 模具 / 产线 + 三组快慢压射与增压参数 + 备注
const RECIPE_FLAG_FIELDS = ['fast1_enabled', 'fast2_enabled', 'boost_enabled'];
const RECIPE_NUMBER_FIELDS = [
  'fast1_position', 'fast1_valve', 'fast2_position', 'fast2_valve',
  'boost_position', 'boost_pressure', 'track_end_pos',
  'fast_energy_pressure', 'boost_energy_pressure',
  'injection_time', 'boost_delay', 'cooling_time', 'hammer_delay', 'slow_flow',
];

// 开关字段统一写法：快射组用「是 / 否」，增压组沿用历史数据中的「1 / 0」
function normalizeRecipeFlag(field, value) {
  if (value === undefined || value === null || value === '') return null;
  const text = String(value).trim();
  if (field === 'boost_enabled') {
    return ['1', '是', 'true', 'on', 'yes'].includes(text.toLowerCase()) ? '1' : '0';
  }
  return ['是', '1', 'true', 'on', 'yes'].includes(text.toLowerCase()) ? '是' : '否';
}

function normalizeRecipeNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

// 配方查询公共部分：产品名称优先取 products 档案，回退历史文本
const RECIPE_SELECT = `
  SELECT mr.*,
         COALESCE(p.product_name, mr.product_name) AS product_name,
         p.product_code, p.product_type,
         m.mold_name, m.mold_code
  FROM mold_recipes mr
  LEFT JOIN products p ON p.id = mr.product_id
  LEFT JOIN molds m ON m.id = mr.mold_id
`;

function recipeWhere({ productId, product, moldId, mold, line }) {
  let where = ' WHERE 1=1';
  const params = [];

  if (productId) { where += ' AND mr.product_id = ?'; params.push(Number(productId)); }
  if (product) {
    where += ' AND (p.product_name LIKE ? OR mr.product_name LIKE ?)';
    params.push(`%${product}%`, `%${product}%`);
  }
  if (moldId) { where += ' AND mr.mold_id = ?'; params.push(Number(moldId)); }
  if (mold) { where += ' AND m.mold_name LIKE ?'; params.push(`%${mold}%`); }
  if (line) { where += ' AND mr.production_line LIKE ?'; params.push(`%${line}%`); }

  return { where, params };
}

function recipeFiltersFromUrl(url) {
  return {
    productId: url.searchParams.get('product_id') || '',
    product: url.searchParams.get('product') || '',
    moldId: url.searchParams.get('mold_id') || '',
    mold: url.searchParams.get('mold') || '',
    line: url.searchParams.get('line') || '',
  };
}

// 全量查询（兼容旧接口）；limit > 0 时限制返回条数，避免导出先全查再截断
function queryRecipes(filters, limit = 0) {
  const { where, params } = recipeWhere(filters);
  const sql = `${RECIPE_SELECT}${where} ORDER BY mr.id${limit > 0 ? ' LIMIT ?' : ''}`;
  return limit > 0
    ? db.prepare(sql).all(...params, limit)
    : db.prepare(sql).all(...params);
}

// GET /api/recipes - 模具配方搜索（返回数组，product / mold 支持 id 或名称关键字）
function searchRecipes(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  json(res, queryRecipes(recipeFiltersFromUrl(url)));
}

// GET /api/recipes/list - 配方分页查询（表格 + 分页使用）
function listRecipes(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const { where, params } = recipeWhere(recipeFiltersFromUrl(url));

  const total = db.prepare(`
    SELECT COUNT(*) AS cnt
    FROM mold_recipes mr
    LEFT JOIN products p ON p.id = mr.product_id
    LEFT JOIN molds m ON m.id = mr.mold_id
    ${where}
  `).get(...params).cnt;

  const { page, pageSize } = parsePaging(url);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);
  const data = db.prepare(`${RECIPE_SELECT}${where} ORDER BY mr.id LIMIT ? OFFSET ?`)
    .all(...params, pageSize, (safePage - 1) * pageSize);

  json(res, { total, page: safePage, pageSize, totalPages, data });
}

// GET /api/recipes/export - 配方导出（CSV，按当前筛选条件导出全部记录）
function exportRecipes(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const rows = queryRecipes(recipeFiltersFromUrl(url), EXPORT_MAX_ROWS);
  const flagText = (value) => (value === '是' || String(value) === '1' ? '开启' : '关闭');

  const headers = [
    '产品名称', '产品编码', '产品类型', '模具名称', '模具编码', '生产线',
    '一快', '一快位置(mm)', '一快阀位',
    '二快', '二快位置(mm)', '二快阀位',
    '增压', '增压位置(mm)', '增压压力(MPa)',
    '跟踪终点(mm)', '快射储能', '增压储能',
    '压射时间(s)', '增压延时(s)', '冷却时间(s)', '锤击延时(s)', '慢压流量',
    '备注', '更新时间',
  ];
  const body = rows.map((r) => [
    r.product_name || '', r.product_code || '', r.product_type || '',
    r.mold_name || '', r.mold_code || '', r.production_line || '',
    flagText(r.fast1_enabled), r.fast1_position, r.fast1_valve,
    flagText(r.fast2_enabled), r.fast2_position, r.fast2_valve,
    flagText(r.boost_enabled), r.boost_position, r.boost_pressure,
    r.track_end_pos, r.fast_energy_pressure, r.boost_energy_pressure,
    r.injection_time, r.boost_delay, r.cooling_time, r.hammer_delay, r.slow_flow,
    r.remark || '', r.updated_at || r.created_at || '',
  ]);

  sendCsv(res, `模具配方_${exportStamp()}.csv`, headers, body);
}

// GET /api/recipes/options - 配方表单 / 筛选下拉数据（产品、模具、已用产线）
function getRecipeOptions(req, res) {
  const products = db.prepare('SELECT id, product_name, product_code FROM products ORDER BY id').all();
  const molds = db.prepare(`
    SELECT id, mold_name, mold_code FROM molds WHERE is_active = 1 ORDER BY mold_name
  `).all();
  const lines = db.prepare(`
    SELECT DISTINCT production_line FROM mold_recipes
    WHERE production_line IS NOT NULL AND production_line <> ''
    ORDER BY production_line
  `).all().map((row) => row.production_line);
  json(res, { products, molds, lines });
}

// 解析并校验配方关联字段：产品必选且必须存在，模具可选
function resolveRecipeRelations(payload) {
  const productId = Number(payload.product_id);
  if (!Number.isInteger(productId) || productId <= 0) {
    return { error: '请选择产品（产品档案来自「产品管理」）' };
  }
  const product = db.prepare('SELECT id, product_name FROM products WHERE id = ?').get(productId);
  if (!product) return { error: '所选产品不存在，请重新选择' };

  const rawMold = payload.mold_id;
  let moldId = null;
  if (rawMold !== undefined && rawMold !== null && String(rawMold).trim() !== '' && String(rawMold) !== '0') {
    const id = Number(rawMold);
    const mold = Number.isInteger(id) && id > 0 ? db.prepare('SELECT id FROM molds WHERE id = ?').get(id) : null;
    if (!mold) return { error: '所选模具不存在，请重新选择' };
    moldId = id;
  }

  return { productId, productName: product.product_name, moldId };
}

// POST /api/recipes/create - 新增配方
function createRecipe(req, res, body) {
  const payload = body || {};
  const relation = resolveRecipeRelations(payload);
  if (relation.error) return json(res, { error: relation.error }, 400);

  const values = RECIPE_NUMBER_FIELDS.map((field) => normalizeRecipeNumber(payload[field]));
  const flags = RECIPE_FLAG_FIELDS.map((field) => normalizeRecipeFlag(field, payload[field])
    || (field === 'boost_enabled' ? '0' : '否'));

  const info = db.prepare(`
    INSERT INTO mold_recipes (
      product_id, product_name, mold_id, production_line,
      fast1_enabled, fast1_position, fast1_valve,
      fast2_enabled, fast2_position, fast2_valve,
      boost_enabled, boost_position, boost_pressure,
      track_end_pos, fast_energy_pressure, boost_energy_pressure,
      injection_time, boost_delay, cooling_time, hammer_delay, slow_flow, remark
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    relation.productId, relation.productName, relation.moldId,
    String(payload.production_line || '').trim(),
    flags[0], values[0], values[1],
    flags[1], values[2], values[3],
    flags[2], values[4], values[5],
    values[6], values[7], values[8],
    values[9], values[10], values[11], values[12], values[13],
    String(payload.remark || '').trim()
  );

  const record = db.prepare('SELECT * FROM mold_recipes WHERE id = ?').get(info.lastInsertRowid);
  logWrite('RECIPE', `新增配方：${relation.productName}（id=${info.lastInsertRowid}）`);
  json(res, { success: true, recipe: record });
}

// POST /api/recipes/update - 修改配方
function updateRecipe(req, res, body) {
  const payload = body || {};
  const id = Number(payload.id);
  const recipe = Number.isInteger(id) && id > 0
    ? db.prepare('SELECT * FROM mold_recipes WHERE id = ?').get(id)
    : null;
  if (!recipe) return json(res, { error: '配方不存在' }, 404);

  // 产品 / 模具关联变更时必须重新校验
  const relation = resolveRecipeRelations({
    product_id: payload.product_id === undefined ? recipe.product_id : payload.product_id,
    mold_id: payload.mold_id === undefined ? recipe.mold_id : payload.mold_id,
  });
  if (relation.error) return json(res, { error: relation.error }, 400);

  const values = RECIPE_NUMBER_FIELDS.map((field) =>
    payload[field] === undefined ? normalizeRecipeNumber(recipe[field]) : normalizeRecipeNumber(payload[field])
  );
  const flags = RECIPE_FLAG_FIELDS.map((field) => {
    const next = normalizeRecipeFlag(field, payload[field]);
    if (next !== null) return next;
    return normalizeRecipeFlag(field, recipe[field]) || (field === 'boost_enabled' ? '0' : '否');
  });

  db.prepare(`
    UPDATE mold_recipes SET
      product_id = ?, product_name = ?, mold_id = ?, production_line = ?,
      fast1_enabled = ?, fast1_position = ?, fast1_valve = ?,
      fast2_enabled = ?, fast2_position = ?, fast2_valve = ?,
      boost_enabled = ?, boost_position = ?, boost_pressure = ?,
      track_end_pos = ?, fast_energy_pressure = ?, boost_energy_pressure = ?,
      injection_time = ?, boost_delay = ?, cooling_time = ?, hammer_delay = ?, slow_flow = ?,
      remark = ?, updated_at = datetime('now','localtime')
    WHERE id = ?
  `).run(
    relation.productId, relation.productName, relation.moldId,
    payload.production_line === undefined ? (recipe.production_line || '') : String(payload.production_line).trim(),
    flags[0], values[0], values[1],
    flags[1], values[2], values[3],
    flags[2], values[4], values[5],
    values[6], values[7], values[8],
    values[9], values[10], values[11], values[12], values[13],
    payload.remark === undefined ? (recipe.remark || '') : String(payload.remark).trim(),
    id
  );

  const record = db.prepare('SELECT * FROM mold_recipes WHERE id = ?').get(id);
  logWrite('RECIPE', `修改配方：${relation.productName}（id=${id}）`);
  json(res, { success: true, recipe: record });
}

// POST /api/recipes/delete - 删除配方
function deleteRecipe(req, res, body) {
  const payload = body || {};
  const id = Number(payload.id);
  const recipe = Number.isInteger(id) && id > 0
    ? db.prepare('SELECT * FROM mold_recipes WHERE id = ?').get(id)
    : null;
  if (!recipe) return json(res, { error: '配方不存在' }, 404);

  db.prepare('DELETE FROM mold_recipes WHERE id = ?').run(id);
  logWrite('RECIPE', `删除配方 id=${id}（${recipe.product_name || ''}）`);
  json(res, { success: true });
}

// ==================== 管路数据模块 ====================

// GET /api/pipeline - 获取管路参数
function getPipeline(req, res) {
  const params = db.prepare('SELECT * FROM pipeline_params ORDER BY id').all();
  json(res, params);
}

// POST /api/pipeline/update - 更新管路参数
function updatePipeline(req, res, body) {
  const { pressure, temperature, flow, valve } = body;
  const updates = [
    { name: '压力设定', value: pressure },
    { name: '温度设定', value: temperature },
    { name: '流量设定', value: flow },
    { name: '阀门开度', value: valve },
  ];

  // 只接受有限数字：Infinity / NaN / 非标量会被拒绝并返回 400
  const invalid = [];
  for (const u of updates) {
    if (u.value === null || u.value === undefined || toText(u.value) === '') continue;
    const num = toFiniteNumber(u.value);
    if (num === null) invalid.push(u.name);
    else u.value = num;
  }
  if (invalid.length) {
    return json(res, { error: `${invalid.join('、')} 必须为有效数字` }, 400);
  }

  const updateStmt = db.prepare('UPDATE pipeline_params SET param_value = ?, updated_at = datetime(\'now\',\'localtime\') WHERE param_name = ?');
  const logStmt = db.prepare('INSERT INTO pipeline_edit_log (param_name, old_value, new_value, edit_time) VALUES (?, ?, ?, datetime(\'now\',\'localtime\'))');

  const transaction = db.transaction(() => {
    for (const u of updates) {
      if (u.value === null || u.value === undefined || toText(u.value) === '') continue;
      const old = db.prepare('SELECT param_value FROM pipeline_params WHERE param_name = ?').get(u.name);
      updateStmt.run(u.value, u.name);
      logStmt.run(u.name, old ? old.param_value : 0, u.value);
    }
  });

  try {
    transaction();
    const params = db.prepare('SELECT * FROM pipeline_params ORDER BY id').all();
    json(res, { success: true, data: params });
  } catch (e) {
    logWrite('ERROR', `保存管路参数失败: ${e && e.stack ? e.stack : e}`);
    json(res, { success: false, error: '保存失败，请查看服务日志' }, 500);
  }
}

// ==================== 安灯呼叫模块 ====================

// GET /api/andon/types - 呼叫类型
function getAndonTypes(req, res) {
  const types = db.prepare('SELECT * FROM andon_call_types WHERE is_active = 1 ORDER BY sort_order').all();
  json(res, types);
}

// GET /api/andon/calls - 呼叫记录
function getAndonCalls(req, res) {
  const calls = db.prepare('SELECT * FROM andon_calls ORDER BY call_time DESC LIMIT 50').all();
  json(res, calls);
}

// POST /api/andon/call - 发起呼叫
function createAndonCall(req, res, body) {
  const callType = toText(body && body.call_type);
  const callDetail = toText(body && body.call_detail);
  const caller = toText(body && body.caller) || '系统自动';
  if (!callType) return json(res, { error: '缺少呼叫类型' }, 400);

  // 呼叫记录与发起日志同事务，避免出现无日志的呼叫
  let newId = null;
  db.transaction(() => {
    const result = db.prepare(`
      INSERT INTO andon_calls (call_type, call_detail, caller, call_time, status)
      VALUES (?, ?, ?, datetime('now','localtime'), 'pending')
    `).run(callType, callDetail, caller);
    newId = result.lastInsertRowid;
    addAndonLog(newId, 'create', operatorName(req, caller), `发起【${callType}】呼叫`);
  })();

  const record = db.prepare('SELECT * FROM andon_calls WHERE id = ?').get(newId);
  json(res, { success: true, call: record });
}

// 写安灯操作日志
function addAndonLog(callId, action, operator, content) {
  db.prepare(`
    INSERT INTO andon_call_logs (call_id, action, operator, content, operate_time)
    VALUES (?, ?, ?, ?, datetime('now','localtime'))
  `).run(callId, action, operator || '系统', content || '');
}

// POST /api/andon/respond - 响应呼叫 (pending -> processing)
function respondAndonCall(req, res, body) {
  const id = Number(body && body.id);
  const handler = toText(body && body.handler) || '未指定';
  if (!Number.isSafeInteger(id) || id <= 0) return json(res, { error: '缺少呼叫ID' }, 400);

  const call = db.prepare('SELECT * FROM andon_calls WHERE id = ?').get(id);
  if (!call) return json(res, { error: '呼叫记录不存在' }, 404);

  // 以状态条件做原子更新，避免先查后改的并发窗口
  let updated = 0;
  db.transaction(() => {
    const info = db.prepare(`
      UPDATE andon_calls
      SET status = 'processing', handler = ?, handle_time = datetime('now','localtime')
      WHERE id = ? AND status = 'pending'
    `).run(handler, id);
    updated = info.changes;
    if (updated) {
      addAndonLog(id, 'respond', operatorName(req, handler), `响应呼叫，开始处理（处理人 ${handler}）`);
    }
  })();
  if (!updated) return json(res, { error: '只有待响应状态的呼叫才能响应' }, 400);

  const record = db.prepare('SELECT * FROM andon_calls WHERE id = ?').get(id);
  json(res, { success: true, call: record });
}

// POST /api/andon/complete - 完成呼叫 (processing -> completed)
function completeAndonCall(req, res, body) {
  const id = Number(body && body.id);
  const handleRemark = toText(body && body.handle_remark);
  const operator = toText(body && body.operator);
  if (!Number.isSafeInteger(id) || id <= 0) return json(res, { error: '缺少呼叫ID' }, 400);

  const call = db.prepare('SELECT * FROM andon_calls WHERE id = ?').get(id);
  if (!call) return json(res, { error: '呼叫记录不存在' }, 404);
  if (call.status === 'completed') return json(res, { error: '该呼叫已完成' }, 400);
  if (call.status === 'cancelled') return json(res, { error: '该呼叫已取消' }, 400);
  if (call.status !== 'processing') return json(res, { error: '请先响应该呼叫，再标记完成' }, 400);

  // 以状态条件做原子更新，避免并发重复完成
  let updated = 0;
  db.transaction(() => {
    const info = db.prepare(`
      UPDATE andon_calls
      SET status = 'completed', handle_remark = ?, handle_time = datetime('now','localtime')
      WHERE id = ? AND status = 'processing'
    `).run(handleRemark, id);
    updated = info.changes;
    if (updated) {
      addAndonLog(id, 'complete', operatorName(req, operator || call.handler || '系统'), `完成处理：${handleRemark || '无备注'}`);
    }
  })();
  if (!updated) return json(res, { error: '请先响应该呼叫，再标记完成' }, 400);

  const record = db.prepare('SELECT * FROM andon_calls WHERE id = ?').get(id);
  json(res, { success: true, call: record });
}

// GET /api/andon/logs - 操作日志
function getAndonLogs(req, res) {
  const logs = db.prepare(`
    SELECT l.*, c.call_type, c.caller AS call_caller
    FROM andon_call_logs l
    LEFT JOIN andon_calls c ON c.id = l.call_id
    ORDER BY l.operate_time DESC, l.id DESC
    LIMIT 100
  `).all();
  json(res, logs);
}

// ==================== 工艺数据模块 ====================

// GET /api/process/data - 工艺数据查询
function getProcessData(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const { page, pageSize } = parsePaging(url);
  const device = url.searchParams.get('device') || '';
  const product = url.searchParams.get('product') || '';
  const batch = url.searchParams.get('batch') || '';
  const rawStart = (url.searchParams.get('startTime') || '').trim();
  const rawEnd = (url.searchParams.get('endTime') || '').trim();
  const startTime = rawStart ? normalizeExportTime(rawStart, false) : '';
  const endTime = rawEnd ? normalizeExportTime(rawEnd, true) : '';
  if (rawStart && !startTime) return json(res, { error: '开始时间格式应为 YYYY-MM-DD 或 YYYY-MM-DD HH:MM' }, 400);
  if (rawEnd && !endTime) return json(res, { error: '结束时间格式应为 YYYY-MM-DD 或 YYYY-MM-DD HH:MM' }, 400);
  if (startTime && endTime && startTime > endTime) {
    return json(res, { error: '开始时间不能晚于结束时间' }, 400);
  }
  const status = url.searchParams.get('status') || '';

  let where = 'WHERE 1=1';
  const params = [];

  if (device) { where += ' AND device_code = ?'; params.push(device); }
  if (product) { where += ' AND product_model = ?'; params.push(product); }
  if (batch) { where += ' AND batch_no LIKE ?'; params.push(`%${batch}%`); }
  if (startTime) { where += ' AND collect_time >= ?'; params.push(startTime); }
  if (endTime) { where += ' AND collect_time <= ?'; params.push(endTime); }
  if (status) { where += ' AND data_status = ?'; params.push(status); }

  const total = db.prepare(`SELECT COUNT(*) AS cnt FROM process_data ${where}`).get(...params).cnt;
  const offset = (page - 1) * pageSize;
  const data = db.prepare(`SELECT * FROM process_data ${where} ORDER BY collect_time DESC LIMIT ? OFFSET ?`).all(...params, pageSize, offset);

  json(res, { total, page, pageSize, data });
}

// GET /api/process/filters - 工艺筛选项（设备取自设备管理表）
function getProcessFilters(req, res) {
  const deviceList = deviceOptionList();
  const products = db.prepare('SELECT DISTINCT product_model FROM process_data ORDER BY product_model').all();
  json(res, {
    devices: deviceList.map(d => d.device_code),
    deviceList,
    products: products.map(p => p.product_model),
  });
}

// GET /api/process/params - 可作为曲线展示的工艺参数清单
function getProcessParams(req, res) {
  json(res, processParamList());
}

// GET /api/process/chart - 工艺参数曲线数据
//   params    逗号分隔的参数列名(必须是 process_data 中的工艺参数列)
//   limit     最近 N 条记录, 取值 50 / 100 / 200(默认 100)
//   startTime / endTime  按采集时间范围查询(填了任意一个即按时间范围模式, 忽略 limit)
//   device / product     可选设备编号、产品型号过滤
function getProcessChart(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const allowed = processParamColumns();
  const keys = (url.searchParams.get('params') || '')
    .split(',')
    .map((k) => k.trim())
    .filter((k) => allowed.includes(k));

  if (!keys.length) {
    return json(res, { error: '请选择至少一个工艺参数' }, 400);
  }

  const device = url.searchParams.get('device') || '';
  const product = url.searchParams.get('product') || '';
  const rawStart = (url.searchParams.get('startTime') || '').trim();
  const rawEnd = (url.searchParams.get('endTime') || '').trim();
  const startTime = rawStart ? normalizeExportTime(rawStart, false) : '';
  const endTime = rawEnd ? normalizeExportTime(rawEnd, true) : '';
  if (rawStart && !startTime) return json(res, { error: '开始时间格式应为 YYYY-MM-DD 或 YYYY-MM-DD HH:MM' }, 400);
  if (rawEnd && !endTime) return json(res, { error: '结束时间格式应为 YYYY-MM-DD 或 YYYY-MM-DD HH:MM' }, 400);
  if (startTime && endTime && startTime > endTime) {
    return json(res, { error: '开始时间不能晚于结束时间' }, 400);
  }
  const byRange = !!(startTime || endTime);

  let where = 'WHERE 1=1';
  const params = [];
  if (device) { where += ' AND device_code = ?'; params.push(device); }
  if (product) { where += ' AND product_model = ?'; params.push(product); }
  if (startTime) { where += ' AND collect_time >= ?'; params.push(startTime); }
  if (endTime) { where += ' AND collect_time <= ?'; params.push(endTime); }

  const MAX_ROWS = 2000;
  const limitRaw = parseInt(url.searchParams.get('limit'), 10) || 100;
  const limit = [50, 100, 200].includes(limitRaw) ? limitRaw : 100;

  const cols = ['collect_time', ...keys].join(', ');

  // 时间范围模式最多取 MAX_ROWS 条, 按条数模式取最近 limit 条
  const rows = byRange
    ? db.prepare(`SELECT ${cols} FROM process_data ${where} ORDER BY collect_time DESC LIMIT ${MAX_ROWS}`).all(...params)
    : db.prepare(`SELECT ${cols} FROM process_data ${where} ORDER BY collect_time DESC LIMIT ?`).all(...params, limit);

  rows.reverse(); // 转为时间升序, 便于从左到右绘制

  json(res, {
    params: keys.map((key) => ({
      key,
      name: (PROCESS_PARAM_META[key] && PROCESS_PARAM_META[key].name) || key,
      unit: (PROCESS_PARAM_META[key] && PROCESS_PARAM_META[key].unit) || '',
    })),
    rows,
    count: rows.length,
    mode: byRange ? 'range' : 'limit',
    limit,
    truncated: byRange && rows.length >= MAX_ROWS,
  });
}

// GET /api/process/export - 工艺数据导出（CSV）
// 时间规则：指定开始/结束时间则导出该时间段，未指定则默认导出最近一个月
function exportProcessData(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const win = exportDateWindow();
  const rawStart = (url.searchParams.get('startTime') || '').trim();
  const rawEnd = (url.searchParams.get('endTime') || '').trim();
  const startTime = rawStart ? normalizeExportTime(rawStart, false) : `${win.startDate} 00:00:00`;
  const endTime = rawEnd ? normalizeExportTime(rawEnd, true) : `${win.endDate} 23:59:59`;
  if (!startTime) return json(res, { error: '开始时间格式应为 YYYY-MM-DD 或 YYYY-MM-DD HH:MM' }, 400);
  if (!endTime) return json(res, { error: '结束时间格式应为 YYYY-MM-DD 或 YYYY-MM-DD HH:MM' }, 400);
  if (startTime > endTime) return json(res, { error: '开始时间不能晚于结束时间' }, 400);

  const device = url.searchParams.get('device') || '';
  const product = url.searchParams.get('product') || '';
  const batch = url.searchParams.get('batch') || '';
  const status = url.searchParams.get('status') || '';

  let where = 'WHERE p.collect_time BETWEEN ? AND ?';
  const params = [startTime, endTime];
  if (device) { where += ' AND p.device_code = ?'; params.push(device); }
  if (product) { where += ' AND p.product_model = ?'; params.push(product); }
  if (batch) { where += ' AND p.batch_no LIKE ?'; params.push(`%${batch}%`); }
  if (status) { where += ' AND p.data_status = ?'; params.push(status); }

  const rows = db.prepare(`
    SELECT p.*, d.device_name
    FROM process_data p
    LEFT JOIN devices d ON d.device_code = p.device_code
    ${where}
    ORDER BY p.collect_time DESC
    LIMIT ${EXPORT_MAX_ROWS}
  `).all(...params);

  // 工艺参数列随 process_data 字段自动变化，新增参数无需改导出
  const paramCols = processParamColumns();
  const headers = [
    '设备编号', '设备名称', '产品型号', '批次号', '工件编号', '采集时间',
    ...paramCols.map((key) => {
      const meta = PROCESS_PARAM_META[key] || {};
      return meta.unit ? `${meta.name || key}(${meta.unit})` : (meta.name || key);
    }),
    '数据状态', '备注',
  ];
  const STATUS_TEXT = { normal: '正常', warning: '预警', unqualified: '不合格' };
  const body = rows.map((r) => [
    r.device_code, r.device_name || '', r.product_model, r.batch_no, r.workpiece_no || '',
    r.collect_time,
    ...paramCols.map((key) => r[key]),
    STATUS_TEXT[r.data_status] || r.data_status || '',
    r.remark || '',
  ]);

  sendCsv(res, `工艺数据_${startTime.slice(0, 10)}_${endTime.slice(0, 10)}_${exportStamp()}.csv`, headers, body);
}

// ==================== CSV 导出工具 ====================
// 导出规则：未指定时间范围时默认导出最近一个月（30 个自然日，含今天）
const EXPORT_DEFAULT_DAYS = 30;
const EXPORT_MAX_ROWS = 50000;

function csvCell(value) {
  if (value === null || value === undefined) return '';
  let s = String(value);
  // 防 CSV 公式注入：非纯数字且以 = + - @ 制表符/回车开头的值，前缀单引号让 Excel 按文本处理
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) {
    s = `'${s}`;
  }
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// 输出 CSV（带 BOM，保证 Excel 打开中文不乱码）
// 逐行流式写出，避免把整份导出内容拼成一个大字符串 / Buffer 占满内存
function sendCsv(res, filename, headers, rows) {
  logResponse(res._reqMethod || 'GET', res._reqPath || '', 200, `导出 ${rows.length} 条`);
  res.writeHead(200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="export.csv"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.write(`\uFEFF${headers.map(csvCell).join(',')}\r\n`);
  for (const row of rows) {
    res.write(`${row.map(csvCell).join(',')}\r\n`);
  }
  res.end();
}

function exportDateWindow() {
  const today = formatDateStr(new Date());
  return { today, startDate: addDays(today, -(EXPORT_DEFAULT_DAYS - 1)), endDate: today };
}

function exportStamp() {
  const d = new Date();
  return `${formatDateStr(d).replace(/-/g, '')}_${pad2(d.getHours())}${pad2(d.getMinutes())}`;
}

// 'YYYY-MM-DD' / 'YYYY-MM-DDTHH:mm' → 'YYYY-MM-DD HH:mm:ss'；非法日历值返回 ''
function normalizeExportTime(value, isEnd) {
  const v = String(value == null ? '' : value).trim().replace('T', ' ');
  if (!v) return '';
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(v)) {
    const d = parseDateStr(v);
    if (!d) return '';
    return `${formatDateStr(d)} ${isEnd ? '23:59:59' : '00:00:00'}`;
  }
  const base = normalizePlanTime(v);
  if (!base) return '';
  if (/^\d{4}-\d{1,2}-\d{1,2} \d{1,2}:\d{2}$/.test(v)) {
    return `${base.slice(0, 16)}:${isEnd ? '59' : '00'}`;
  }
  return base;
}

// ==================== 历史工件分析模块 ====================
// 数据来源：process_data（工艺数据表），不单独存储分析业务数据。
// 判定依据：按工艺记录的采集时间匹配当时生效的分析标准版本。

// 查询某个产品在指定时间点生效的标准版本（产品专属优先，其次通用版本）
function findVersionForRecord(productModel, collectTime) {
  const t = collectTime || '';
  const specific = db.prepare(`
    SELECT * FROM analysis_standard_versions
    WHERE is_active = 1
      AND product_model = ?
      AND effective_from <= ?
      AND (effective_to IS NULL OR effective_to = '' OR effective_to >= ?)
    ORDER BY effective_from DESC, id DESC
    LIMIT 1
  `).get(productModel || '', t, t);
  if (specific) return specific;

  return db.prepare(`
    SELECT * FROM analysis_standard_versions
    WHERE is_active = 1
      AND (product_model IS NULL OR product_model = '')
      AND effective_from <= ?
      AND (effective_to IS NULL OR effective_to = '' OR effective_to >= ?)
    ORDER BY effective_from DESC, id DESC
    LIMIT 1
  `).get(t, t);
}

// 当前（此刻）生效的标准版本
function getCurrentVersion() {
  const now = db.prepare("SELECT datetime('now','localtime') AS t").get().t;
  const v = findVersionForRecord('', now);
  if (v) return v;
  return db.prepare(`
    SELECT * FROM analysis_standard_versions
    WHERE is_active = 1
    ORDER BY (effective_from <= ?) DESC, effective_from DESC, id DESC
    LIMIT 1
  `).get(now) || null;
}

function versionStandards(versionId) {
  if (!versionId) return [];
  return db.prepare(`
    SELECT * FROM analysis_standards
    WHERE version_id = ? AND is_active = 1
    ORDER BY display_order, id
  `).all(versionId);
}

// 单条工艺记录按标准判定：偏差 ≤ 容差为合格，≤ 2 倍容差为预警，超过为不合格
function judgeRecord(row, standards) {
  if (!standards || !standards.length) {
    return { judge_result: 'no_standard', judge_detail: '该采集时间未匹配到生效的分析标准' };
  }
  let worst = 0;
  const details = [];
  for (const s of standards) {
    const raw = row[s.param_key];
    if (raw === null || raw === undefined || raw === '') continue;
    const value = Number(raw);
    if (Number.isNaN(value)) continue;
    const stdValue = Number(s.standard_value);
    const tol = Math.abs(Number(s.tolerance) || 0);
    const diff = value - stdValue;
    const abs = Math.abs(diff);
    // 引入极小 epsilon，避免 0.1+0.2 这类浮点表示误差把边界值误判为超差
    const EPS = 1e-9;
    let level = 0;
    if (abs > tol + EPS) level = abs <= tol * 2 + EPS ? 1 : 2;
    if (level > worst) worst = level;
    if (level > 0) {
      details.push(`${s.param_name}${diff > 0 ? '+' : ''}${diff.toFixed(2)}${s.unit || ''}${level === 2 ? '超差' : '预警'}`);
    }
  }
  const resultMap = ['qualified', 'warning', 'unqualified'];
  return {
    judge_result: resultMap[worst],
    judge_detail: details.length ? details.join('；') : '全部参数在标准范围内',
  };
}

// GET /api/analysis/standards - 当前生效版本的标准明细（兼容旧接口）
function getAnalysisStandards(req, res) {
  const version = getCurrentVersion();
  json(res, version ? versionStandards(version.id) : []);
}

// GET /api/analysis/data - 分析数据（来源 process_data）
function getAnalysisData(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const { page, pageSize } = parsePaging(url);
  const keyword = url.searchParams.get('keyword') || '';
  const device = url.searchParams.get('device') || '';
  const product = url.searchParams.get('product') || '';
  const rawStart = (url.searchParams.get('startTime') || '').trim();
  const rawEnd = (url.searchParams.get('endTime') || '').trim();
  const startTime = rawStart ? normalizePlanTime(rawStart) : '';
  const endTime = rawEnd ? normalizePlanTime(rawEnd) : '';
  if (rawStart && !startTime) return json(res, { error: '开始时间格式应为 YYYY-MM-DD HH:MM' }, 400);
  if (rawEnd && !endTime) return json(res, { error: '结束时间格式应为 YYYY-MM-DD HH:MM' }, 400);

  let where = 'WHERE 1=1';
  const params = [];
  if (keyword) {
    where += ' AND (workpiece_no LIKE ? OR batch_no LIKE ? OR device_code LIKE ?)';
    params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
  }
  if (device) { where += ' AND device_code = ?'; params.push(device); }
  if (product) { where += ' AND product_model = ?'; params.push(product); }
  if (startTime) { where += ' AND collect_time >= ?'; params.push(startTime); }
  if (endTime) { where += ' AND collect_time <= ?'; params.push(endTime); }

  // 只查询判定需要的列（元信息 + 被标准引用的工艺参数），避免 SELECT * 撑大内存
  const dataColumns = tableColumns('process_data');
  const standardParamKeys = [...new Set(
    db.prepare('SELECT DISTINCT param_key FROM analysis_standards WHERE is_active = 1').all()
      .map((r) => r.param_key)
  )].filter((key) => dataColumns.includes(key) && !PROCESS_META_COLUMNS.includes(key));
  const analysisColumns = [
    'id', 'collect_time', 'device_code', 'product_model', 'batch_no', 'workpiece_no', 'data_status', 'remark',
    ...standardParamKeys,
  ].filter((key, index, arr) => dataColumns.includes(key) && arr.indexOf(key) === index);
  const selectSql = analysisColumns.length ? analysisColumns.join(', ') : 'id';

  // 判定需要全量合格率，因此按上限扫描（避免数据增长后无界占用内存）
  // 可通过 ANALYSIS_MAX_SCAN 调整；值越大单次请求阻塞越久
  const ANALYSIS_MAX_SCAN = Math.max(1000, Number(process.env.ANALYSIS_MAX_SCAN) || 20000);
  const rows = db.prepare(`
    SELECT ${selectSql} FROM process_data ${where}
    ORDER BY collect_time DESC, id DESC
    LIMIT ${ANALYSIS_MAX_SCAN}
  `).all(...params);
  const truncated = rows.length >= ANALYSIS_MAX_SCAN;

  // 标准版本一次性载入内存匹配，避免逐行查库（数据量大时性能关键）
  const allVersions = db.prepare(
    'SELECT * FROM analysis_standard_versions WHERE is_active = 1'
  ).all();

  const stdCache = new Map();
  const getStandards = (versionId) => {
    if (!stdCache.has(versionId)) stdCache.set(versionId, versionStandards(versionId));
    return stdCache.get(versionId);
  };

  const judged = rows.map((row) => {
    const version = pickVersionForTime(allVersions, row.product_model, row.collect_time);
    const standards = version ? getStandards(version.id) : [];
    const result = judgeRecord(row, standards);
    return {
      ...row,
      ...result,
      standard_version_id: version ? version.id : null,
      standard_version_code: version ? version.version_code : '',
      standard_version_name: version ? version.version_name : '未匹配标准',
    };
  });

  const total = judged.length;
  // 单次遍历完成分类统计，避免对大数组重复 filter
  let unqualified = 0;
  let warning = 0;
  let qualified = 0;
  let noStandard = 0;
  for (const row of judged) {
    if (row.judge_result === 'unqualified') unqualified += 1;
    else if (row.judge_result === 'warning') warning += 1;
    else if (row.judge_result === 'qualified') qualified += 1;
    else noStandard += 1;
  }
  const rate = (n) => (total > 0 ? ((n / total) * 100).toFixed(1) : '0.0');

  // 表格展示列：所有涉及版本的标准参数并集（同一参数只保留首次出现的定义）
  const paramMap = new Map();
  const usedVersionIds = new Set();
  judged.forEach((r) => {
    if (!r.standard_version_id) return;
    usedVersionIds.add(r.standard_version_id);
    getStandards(r.standard_version_id).forEach((s) => {
      if (!paramMap.has(s.param_key)) paramMap.set(s.param_key, s);
    });
  });
  const currentVersion = getCurrentVersion();
  const fallbackStandards = currentVersion ? getStandards(currentVersion.id) : [];
  const columns = (paramMap.size ? [...paramMap.values()] : fallbackStandards)
    .map(s => ({
      param_key: s.param_key,
      param_name: s.param_name,
      unit: s.unit || '',
      display_order: s.display_order || 0,
    }))
    .sort((a, b) => (a.display_order - b.display_order));

  // 分页与其他列表接口保持一致：越界页回落到最后一页
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);
  const offset = (safePage - 1) * pageSize;
  const pageRows = judged.slice(offset, offset + pageSize);

  // 仅下发当前页涉及版本的标准明细，由前端按 standard_version_id 取用
  const standardsByVersion = {};
  pageRows.forEach((r) => {
    if (r.standard_version_id && !standardsByVersion[r.standard_version_id]) {
      standardsByVersion[r.standard_version_id] = getStandards(r.standard_version_id);
    }
  });

  json(res, {
    total,
    page: safePage,
    pageSize,
    totalPages,
    truncated,
    qualifiedCount: qualified,
    warningCount: warning,
    unqualifiedCount: unqualified,
    noStandardCount: noStandard,
    qualifiedRate: rate(qualified),
    unqualifiedRate: rate(unqualified),
    params: columns,
    standards: fallbackStandards,
    standardsByVersion,
    version: currentVersion,
    data: pageRows,
  });
}

// 在已加载的版本列表中挑选某产品、某时刻生效的标准版本
// 规则：产品专属版本优先于通用版本；同优先级取生效时间最晚、id 最大者
function pickVersionForTime(versions, productModel, collectTime) {
  const t = collectTime || '';
  let best = null;
  let bestSpecific = false;
  for (const v of versions) {
    if (v.effective_from > t) continue;
    if (v.effective_to && v.effective_to !== '' && v.effective_to < t) continue;
    const specific = !!(v.product_model && v.product_model === productModel);
    if (v.product_model && !specific) continue;
    if (!best) {
      best = v;
      bestSpecific = specific;
      continue;
    }
    if (specific !== bestSpecific) {
      if (specific) { best = v; bestSpecific = true; }
      continue;
    }
    if (v.effective_from > best.effective_from ||
      (v.effective_from === best.effective_from && v.id > best.id)) {
      best = v;
    }
  }
  return best;
}

// GET /api/analysis/filters - 分析筛选项（设备取自设备管理表）
function getAnalysisFilters(req, res) {
  const deviceList = deviceOptionList();
  const products = db.prepare('SELECT DISTINCT product_model FROM process_data WHERE product_model IS NOT NULL ORDER BY product_model').all();
  json(res, {
    devices: deviceList.map(d => d.device_code),
    deviceList,
    products: products.map(p => p.product_model),
  });
}

// ==================== 分析标准维护（数据库内可增删改，按时间段生效） ====================

function addStandardLog(versionId, versionCode, action, target, content, operator) {
  // 统一走 toText：对象 / 数组等非标量不会写进日志，也不会触发绑定异常
  db.prepare(`
    INSERT INTO analysis_standard_logs (version_id, version_code, action, target, content, operator)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(versionId || null, toText(versionCode), toText(action), toText(target), toText(content), toText(operator) || '系统');
}

// 'YYYY-MM-DD' / 'YYYY-MM-DD HH:mm[:ss]' → 'YYYY-MM-DD HH:mm:ss'，非法日历值返回 ''
function normalizeDateTime(value) {
  if (!value) return '';
  let s = String(value).trim().replace('T', ' ');
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) s += ' 00:00:00';
  else if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(s)) s += ':00';
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(s);
  if (!m) return '';
  const [year, month, day, hour, minute, second] = [
    Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]),
  ];
  if (!isValidDateParts(year, month, day)) return '';
  if (hour > 23 || minute > 59 || second > 59) return '';
  return `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}:${m[6]}`;
}

// 标准值 / 容差解析：空串与 Infinity 都视为非法
function toNumber(value) {
  return toFiniteNumber(value);
}

// GET /api/analysis/versions - 标准版本列表（含明细） + 可选用参数清单
function getAnalysisVersions(req, res) {
  const versions = db.prepare(`
    SELECT * FROM analysis_standard_versions
    ORDER BY effective_from DESC, id DESC
  `).all();
  const standards = db.prepare(`
    SELECT * FROM analysis_standards WHERE is_active = 1 ORDER BY display_order, id
  `).all();
  const grouped = {};
  standards.forEach((s) => {
    if (!grouped[s.version_id]) grouped[s.version_id] = [];
    grouped[s.version_id].push(s);
  });
  versions.forEach((v) => {
    v.standards = grouped[v.id] || [];
    v.param_count = v.standards.length;
  });

  const current = getCurrentVersion();
  json(res, {
    versions,
    currentVersionId: current ? current.id : null,
    params: processParamList(),
  });
}

// POST /api/analysis/versions - 新增标准版本
function createAnalysisVersion(req, res, body) {
  const payload = body || {};
  const name = toText(payload.version_name);
  const product = toText(payload.product_model);
  const rawFrom = toText(payload.effective_from);
  const rawTo = toText(payload.effective_to);
  const from = normalizeDateTime(rawFrom);
  const to = normalizeDateTime(rawTo);
  if (!name) return json(res, { error: '缺少版本名称' }, 400);
  if (!from) return json(res, { error: '生效开始时间格式应为 YYYY-MM-DD HH:MM，且必须是有效日期' }, 400);
  if (rawTo && !to) return json(res, { error: '生效结束时间格式应为 YYYY-MM-DD HH:MM，且必须是有效日期' }, 400);
  if (to && to < from) return json(res, { error: '生效结束时间不能早于开始时间' }, 400);

  let code = toText(payload.version_code);
  if (!code) {
    const seed = from.slice(0, 10).replace(/-/g, '');
    code = `STD-${seed}`;
    let i = 2;
    while (db.prepare('SELECT id FROM analysis_standard_versions WHERE version_code = ?').get(code)) {
      code = `STD-${seed}-${i++}`;
    }
  }
  if (db.prepare('SELECT id FROM analysis_standard_versions WHERE version_code = ?').get(code)) {
    return json(res, { error: `版本编码 ${code} 已存在` }, 400);
  }

  const info = db.prepare(`
    INSERT INTO analysis_standard_versions
      (version_code, version_name, product_model, effective_from, effective_to, remark)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(code, name, product || null, from, to || null, toText(payload.remark));

  addStandardLog(info.lastInsertRowid, code, 'create_version', name,
    `新增标准版本，有效期 ${from} ~ ${to || '至今'}，适用产品 ${product || '全部'}`, operatorName(req));

  const record = db.prepare('SELECT * FROM analysis_standard_versions WHERE id = ?').get(info.lastInsertRowid);
  json(res, { success: true, version: record });
}

// POST /api/analysis/versions/update - 修改标准版本
function updateAnalysisVersion(req, res, body) {
  const payload = body || {};
  const id = Number(payload.id);
  const version = Number.isSafeInteger(id) && id > 0
    ? db.prepare('SELECT * FROM analysis_standard_versions WHERE id = ?').get(id)
    : null;
  if (!version) return json(res, { error: '标准版本不存在' }, 404);

  const name = (payload.version_name != null ? toText(payload.version_name) : toText(version.version_name));
  const rawFrom = payload.effective_from != null ? toText(payload.effective_from) : (version.effective_from || '');
  const rawTo = payload.effective_to != null ? toText(payload.effective_to) : (version.effective_to || '');
  const from = normalizeDateTime(rawFrom);
  const to = normalizeDateTime(rawTo);
  if (!name) return json(res, { error: '缺少版本名称' }, 400);
  if (!from) return json(res, { error: '生效开始时间格式应为 YYYY-MM-DD HH:MM，且必须是有效日期' }, 400);
  if (rawTo && !to) return json(res, { error: '生效结束时间格式应为 YYYY-MM-DD HH:MM，且必须是有效日期' }, 400);
  if (to && to < from) return json(res, { error: '生效结束时间不能早于开始时间' }, 400);

  const product = (payload.product_model != null ? toText(payload.product_model) : toText(version.product_model)) || null;
  const active = payload.is_active != null ? (Number(payload.is_active) ? 1 : 0) : version.is_active;
  const remark = payload.remark != null ? toText(payload.remark) : toText(version.remark);

  db.prepare(`
    UPDATE analysis_standard_versions
    SET version_name = ?, product_model = ?, effective_from = ?, effective_to = ?,
        remark = ?, is_active = ?, updated_at = datetime('now','localtime')
    WHERE id = ?
  `).run(name, product, from, to || null, remark, active, id);

  addStandardLog(id, version.version_code, 'update_version', name,
    `修改标准版本：有效期 ${from} ~ ${to || '至今'}，适用产品 ${product || '全部'}，状态 ${active ? '启用' : '停用'}`,
    operatorName(req));

  const record = db.prepare('SELECT * FROM analysis_standard_versions WHERE id = ?').get(id);
  json(res, { success: true, version: record });
}

// POST /api/analysis/versions/delete - 删除标准版本（连同其标准明细）
function deleteAnalysisVersion(req, res, body) {
  const payload = body || {};
  const id = Number(payload.id);
  const version = Number.isSafeInteger(id) && id > 0
    ? db.prepare('SELECT * FROM analysis_standard_versions WHERE id = ?').get(id)
    : null;
  if (!version) return json(res, { error: '标准版本不存在' }, 404);

  // 明细、版本、审计日志必须一起成功
  db.transaction(() => {
    db.prepare('DELETE FROM analysis_standards WHERE version_id = ?').run(id);
    db.prepare('DELETE FROM analysis_standard_versions WHERE id = ?').run(id);
    addStandardLog(id, version.version_code, 'delete_version', version.version_name,
      '删除标准版本及其全部标准明细', operatorName(req));
  })();

  json(res, { success: true });
}

// POST /api/analysis/standards/create - 新增标准参数（参数必须存在于工艺数据表）
function createAnalysisStandard(req, res, body) {
  const payload = body || {};
  const versionId = Number(payload.version_id);
  const version = Number.isSafeInteger(versionId) && versionId > 0
    ? db.prepare('SELECT * FROM analysis_standard_versions WHERE id = ?').get(versionId)
    : null;
  if (!version) return json(res, { error: '标准版本不存在' }, 404);

  const key = toText(payload.param_key);
  if (!key) return json(res, { error: '缺少工艺参数' }, 400);
  if (!processParamColumns().includes(key)) {
    return json(res, { error: `工艺数据表中不存在参数 ${key}，无法作为分析标准` }, 400);
  }
  if (db.prepare('SELECT id FROM analysis_standards WHERE version_id = ? AND param_key = ?').get(versionId, key)) {
    return json(res, { error: '该版本已包含此参数标准' }, 400);
  }

  const stdValue = toNumber(payload.standard_value);
  const tol = toNumber(payload.tolerance);
  if (stdValue === null) return json(res, { error: '标准值必须为数字' }, 400);
  if (tol === null || tol < 0) return json(res, { error: '容差必须为不小于 0 的数字' }, 400);

  const meta = PROCESS_PARAM_META[key] || {};
  const name = toText(payload.param_name) || meta.name || key;
  const u = toText(payload.unit) || meta.unit || '';
  const order = toNumber(payload.display_order);
  const nextOrder = order !== null ? order : (db.prepare(
    'SELECT COALESCE(MAX(display_order), 0) + 1 AS n FROM analysis_standards WHERE version_id = ?'
  ).get(versionId).n);

  const info = db.prepare(`
    INSERT INTO analysis_standards
      (version_id, param_name, param_key, standard_value, tolerance, unit, display_order)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(versionId, name, key, stdValue, tol, u, nextOrder);

  addStandardLog(versionId, version.version_code, 'create', name,
    `新增标准参数 ${name}：${stdValue} ± ${tol} ${u}`, operatorName(req));

  const record = db.prepare('SELECT * FROM analysis_standards WHERE id = ?').get(info.lastInsertRowid);
  json(res, { success: true, standard: record });
}

// POST /api/analysis/standards/update - 修改标准参数
function updateAnalysisStandard(req, res, body) {
  const payload = body || {};
  const id = Number(payload.id);
  const std = Number.isSafeInteger(id) && id > 0
    ? db.prepare('SELECT * FROM analysis_standards WHERE id = ?').get(id)
    : null;
  if (!std) return json(res, { error: '标准参数不存在' }, 404);

  const stdValue = payload.standard_value != null ? toNumber(payload.standard_value) : Number(std.standard_value);
  const tol = payload.tolerance != null ? toNumber(payload.tolerance) : Number(std.tolerance);
  if (stdValue === null) return json(res, { error: '标准值必须为数字' }, 400);
  if (tol === null || tol < 0) return json(res, { error: '容差必须为不小于 0 的数字' }, 400);

  const name = (payload.param_name != null ? toText(payload.param_name) : toText(std.param_name)) || std.param_name;
  const u = payload.unit != null ? toText(payload.unit) : toText(std.unit);
  const order = payload.display_order != null ? (toNumber(payload.display_order) ?? std.display_order) : std.display_order;
  const active = payload.is_active != null ? (Number(payload.is_active) ? 1 : 0) : std.is_active;

  db.prepare(`
    UPDATE analysis_standards
    SET param_name = ?, standard_value = ?, tolerance = ?, unit = ?,
        display_order = ?, is_active = ?, updated_at = datetime('now','localtime')
    WHERE id = ?
  `).run(name, stdValue, tol, u, order, active, id);

  const version = db.prepare('SELECT * FROM analysis_standard_versions WHERE id = ?').get(std.version_id);
  addStandardLog(std.version_id, version ? version.version_code : '', 'update', name,
    `修改标准：原 ${std.standard_value} ± ${std.tolerance} → 新 ${stdValue} ± ${tol} ${u}`, operatorName(req));

  const record = db.prepare('SELECT * FROM analysis_standards WHERE id = ?').get(id);
  json(res, { success: true, standard: record });
}

// POST /api/analysis/standards/delete - 删除标准参数
function deleteAnalysisStandard(req, res, body) {
  const payload = body || {};
  const id = Number(payload.id);
  const std = Number.isSafeInteger(id) && id > 0
    ? db.prepare('SELECT * FROM analysis_standards WHERE id = ?').get(id)
    : null;
  if (!std) return json(res, { error: '标准参数不存在' }, 404);

  db.prepare('DELETE FROM analysis_standards WHERE id = ?').run(id);
  const version = db.prepare('SELECT * FROM analysis_standard_versions WHERE id = ?').get(std.version_id);
  addStandardLog(std.version_id, version ? version.version_code : '', 'delete', std.param_name,
    `删除标准参数 ${std.param_name}（${std.standard_value} ± ${std.tolerance}）`, operatorName(req));

  json(res, { success: true });
}

// POST /api/analysis/standards/reorder - 批量调整某版本标准参数的显示顺序
//   body: { version_id, ids: [按新顺序排列的标准 id 数组], operator }
function reorderAnalysisStandards(req, res, body) {
  const payload = body || {};
  const versionId = Number(payload.version_id);
  const version = Number.isSafeInteger(versionId) && versionId > 0
    ? db.prepare('SELECT * FROM analysis_standard_versions WHERE id = ?').get(versionId)
    : null;
  if (!version) return json(res, { error: '标准版本不存在' }, 404);

  const list = Array.isArray(payload.ids)
    ? payload.ids.map((v) => Number(v)).filter((v) => Number.isSafeInteger(v) && v > 0)
    : [];
  if (!list.length) return json(res, { error: '缺少排序参数' }, 400);

  const upd = db.prepare(`
    UPDATE analysis_standards
    SET display_order = ?, updated_at = datetime('now','localtime')
    WHERE id = ? AND version_id = ?
  `);
  let updated = 0;
  const tx = db.transaction(() => {
    list.forEach((id, i) => {
      updated += upd.run(i + 1, id, versionId).changes;
    });
  });
  tx();

  addStandardLog(versionId, version.version_code, 'update', '显示顺序',
    `调整标准参数显示顺序（实际更新 ${updated} 项）`, operatorName(req));

  // 返回实际更新行数，便于前端发现被过滤掉的越权 / 无效 id
  json(res, { success: true, count: updated, requested: list.length });
}

// GET /api/analysis/params - 可作为分析标准的工艺参数清单
function getAnalysisParams(req, res) {
  json(res, processParamList());
}

// GET /api/analysis/standard-logs - 标准变更日志
function getAnalysisStandardLogs(req, res) {
  const logs = db.prepare(`
    SELECT * FROM analysis_standard_logs ORDER BY operate_time DESC, id DESC LIMIT 100
  `).all();
  json(res, logs);
}

// ==================== 登录 / 会话 / 用户权限 ====================
function pad2(n) {
  return String(n).padStart(2, '0');
}

function stampNow(offsetMs = 0) {
  const d = new Date(Date.now() + offsetMs);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} `
    + `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

// 密码哈希：scrypt（随机盐 + 恒定时间比较）
// 同步版本仅用于启动建库 / 数据迁移；请求路径一律走异步版本，避免阻塞事件循环
function hashPasswordSync(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 32).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

function scryptAsync(password, salt) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(String(password), salt, 32, (err, derived) => {
      if (err) reject(err);
      else resolve(derived);
    });
  });
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = (await scryptAsync(password, salt)).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

async function verifyPassword(password, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const [, salt, hash] = parts;
  try {
    const calc = await scryptAsync(password, salt);
    const expect = Buffer.from(hash, 'hex');
    if (expect.length !== calc.length) return false;
    return crypto.timingSafeEqual(calc, expect);
  } catch {
    return false;
  }
}

// 异步处理兜底：路由层不 await，异常必须在此收敛，避免请求悬挂
function runAsync(res, label, task) {
  return Promise.resolve()
    .then(task)
    .catch((err) => {
      logWrite('ERROR', `${label}失败: ${err && err.stack ? err.stack : err}`);
      if (!res.headersSent) {
        json(res, { error: `${label}失败，请稍后再试` }, 500);
      } else {
        try { res.end(); } catch { /* 忽略重复结束 */ }
      }
    });
}

const PASSWORD_MIN_LENGTH = 6;
const PASSWORD_MAX_LENGTH = 128;

function isValidPasswordLength(password) {
  return password.length >= PASSWORD_MIN_LENGTH && password.length <= PASSWORD_MAX_LENGTH;
}

function parseCookies(header) {
  const out = {};
  String(header || '').split(';').forEach((part) => {
    const idx = part.indexOf('=');
    if (idx < 0) return;
    const key = part.slice(0, idx).trim();
    if (!key) return;
    try {
      out[key] = decodeURIComponent(part.slice(idx + 1).trim());
    } catch {
      // 畸形编码（如 %、%E0%A4%A）不能抛异常，否则整个请求会悬挂
      out[key] = '';
    }
  });
  return out;
}

function sessionCookieHeader(token, maxAgeSec) {
  // HTTPS 部署（COOKIE_SECURE=1）时追加 Secure，避免会话 Cookie 明文回传
  const secure = COOKIE_SECURE ? '; Secure' : '';
  return `${AUTH_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${secure}`;
}

// 客户端 IP：未显式声明信任反向代理时，只取直连地址，防止伪造 X-Forwarded-For 绕过限流
function clientIp(req) {
  const socketIp = (req.socket && req.socket.remoteAddress) || '';
  if (!TRUST_PROXY) return socketIp;
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || socketIp;
}

function parseJsonList(value) {
  try {
    const arr = JSON.parse(value || '[]');
    return Array.isArray(arr) ? arr.map((v) => String(v)) : [];
  } catch {
    return [];
  }
}

function sanitizeAssignments(list, allowed) {
  if (!Array.isArray(list)) return [];
  return [...new Set(list.map((v) => String(v)).filter((v) => allowed.includes(v)))];
}

function isSuperUser(user) {
  return !!user && user.role === 'super';
}

// 审计操作人：一律取当前登录用户，禁止前端自由传入伪造
function operatorName(req, fallback = '系统') {
  const user = req && req.user;
  if (user && user.username) return user.username;
  return fallback;
}

// 用户管理权限：超管，或拥有「用户权限」页面（含 user 相关动作）的账号
function isUserManager(row) {
  if (!row) return false;
  if (isSuperUser(row)) return true;
  const pages = parseJsonList(row.admin_pages);
  const actions = parseJsonList(row.actions);
  return pages.includes('user') || actions.some((k) => String(k).startsWith('user:'));
}

// 对外用户信息（不含密码哈希）
function authPayload(user) {
  if (!user) return null;
  const displayPages = isSuperUser(user) ? DISPLAY_PAGE_KEYS.slice() : parseJsonList(user.display_pages);
  const adminPages = isSuperUser(user) ? ADMIN_PAGE_KEYS.slice() : parseJsonList(user.admin_pages);
  // 旧数据可能残留「没有对应页面却勾了动作」的组合，读取时同样收敛
  const effective = pruneActionsByPages({
    display_pages: displayPages,
    admin_pages: adminPages,
    actions: isSuperUser(user)
      ? ALL_ACTION_KEYS.slice()
      : parseJsonList(user.actions).filter((k) => ALL_ACTION_KEYS.includes(k)),
  });
  return {
    id: Number(user.id),
    username: user.username,
    display_name: user.display_name || user.username,
    role: user.role,
    is_super: isSuperUser(user),
    is_active: Number(user.is_active) === 1 ? 1 : 0,
    display_pages: displayPages,
    admin_pages: adminPages,
    actions: effective.actions,
    last_login_at: user.last_login_at || '',
    created_at: user.created_at || '',
  };
}

function authMeta() {
  return {
    display_pages: DISPLAY_PAGES,
    admin_pages: ADMIN_PAGES,
    actions: ACTION_CATALOG,
    session_hours: SESSION_TTL_HOURS,
  };
}

// 按钮级权限：超级管理员拥有全部动作；普通用户必须先拥有该模块页面，动作才生效
function userCanAction(user, module, action) {
  if (!user) return false;
  if (isSuperUser(user)) return true;
  const owned = new Set([...parseJsonList(user.display_pages), ...parseJsonList(user.admin_pages)]);
  if (!owned.has(module)) return false;
  return parseJsonList(user.actions).includes(`${module}:${action}`);
}

// 页面级读权限：用户拥有的看板 / 后台页面任一命中即可
function userCanRead(user, modules) {
  if (!user) return false;
  if (isSuperUser(user)) return true;
  if (!Array.isArray(modules) || !modules.length) return true;
  const owned = new Set([...parseJsonList(user.display_pages), ...parseJsonList(user.admin_pages)]);
  return modules.some((m) => owned.has(m));
}

function findWritePermission(pathname) {
  return WRITE_API_PERMISSIONS.find((item) => item.pattern.test(pathname)) || null;
}

function findReadModules(pathname) {
  const hit = READ_API_MODULES.find((item) => pathname === item.prefix || pathname.startsWith(`${item.prefix}/`));
  return hit ? hit.modules : null;
}

function getSessionUser(req) {
  const token = parseCookies(req.headers.cookie)[AUTH_COOKIE];
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const row = db.prepare(`
    SELECT u.*, s.token AS session_token, s.expires_at AS session_expires
    FROM user_sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token = ?
  `).get(token);
  if (!row) return null;
  if (String(row.session_expires || '') <= stampNow()) {
    db.prepare('DELETE FROM user_sessions WHERE token = ?').run(token);
    return null;
  }
  if (Number(row.is_active) !== 1) return null;
  // 滑动续期：剩余不足 1/3 时顺延，避免每个请求都写库
  const expiresAt = new Date(String(row.session_expires).replace(' ', 'T')).getTime();
  if (Number.isFinite(expiresAt) && expiresAt - Date.now() < (SESSION_TTL_HOURS * 3600 * 1000) / 3) {
    db.prepare('UPDATE user_sessions SET expires_at = ? WHERE token = ?')
      .run(stampNow(SESSION_TTL_HOURS * 3600 * 1000), token);
  }
  return row;
}

// 统一解析身份：会话 Cookie 优先；配置了 ADMIN_TOKEN 时允许脚本携带机器令牌（等同超级管理员）
function resolveAuth(req) {
  const user = getSessionUser(req);
  if (user) return { user, source: 'session' };
  if (ADMIN_TOKEN && String(req.headers['x-admin-token'] || '') === ADMIN_TOKEN) {
    return { user: { id: 0, username: 'system', display_name: '系统任务', role: 'super', is_active: 1 }, source: 'token' };
  }
  return { user: null, source: 'none' };
}

function createSession(userId, req) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = stampNow(SESSION_TTL_HOURS * 3600 * 1000);
  db.prepare(`
    INSERT INTO user_sessions (token, user_id, created_at, expires_at, last_seen, ip, user_agent)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(token, userId, stampNow(), expires, stampNow(), clientIp(req),
    String(req.headers['user-agent'] || '').slice(0, 200));
  return token;
}

function destroySession(token) {
  if (!token) return;
  db.prepare('DELETE FROM user_sessions WHERE token = ?').run(token);
}

// 同源校验：携带会话 Cookie 的写请求若带 Origin，必须与 Host 一致（防 CSRF）
// 缺少 Origin 时退化为 Referer 校验；两者都没有则视为非浏览器客户端，交由会话与权限校验
function sameOriginRequest(req) {
  const host = String(req.headers.host || '');
  const origin = String(req.headers.origin || '').trim();
  if (origin) {
    try {
      return new URL(origin).host === host;
    } catch {
      return false;
    }
  }
  const referer = String(req.headers.referer || '').trim();
  if (referer) {
    try {
      return new URL(referer).host === host;
    } catch {
      return false;
    }
  }
  return true;
}

function loginFailureState(key) {
  const state = loginFailures.get(key);
  if (!state) return null;
  if (state.until && state.until > Date.now()) return { locked: true, seconds: Math.ceil((state.until - Date.now()) / 1000) };
  if (!state.until) return null;
  loginFailures.delete(key);
  return null;
}

function recordLoginFailure(key) {
  const state = loginFailures.get(key) || { count: 0, until: 0 };
  state.count += 1;
  if (state.count >= LOGIN_MAX_FAILS) {
    state.until = Date.now() + LOGIN_LOCK_SECONDS * 1000;
    state.count = 0;
    logWrite('WARN', `登录失败次数过多，锁定 ${LOGIN_LOCK_SECONDS} 秒：${key}`);
  }
  loginFailures.set(key, state);
  if (loginFailures.size > 5000) {
    // 简单清理，避免长期运行后 Map 无限增长
    const now = Date.now();
    for (const [k, v] of loginFailures) {
      if (!v.until || v.until < now) loginFailures.delete(k);
    }
  }
}

// POST /api/auth/login - 账号密码登录（HttpOnly Cookie 会话）
// 包装层负责并发闸门与异常兜底，实际校验走异步 scrypt，避免阻塞事件循环
function login(req, res, body) {
  if (loginInFlight >= LOGIN_MAX_CONCURRENT) {
    return json(res, { error: '登录请求过多，请稍后再试' }, 429);
  }
  loginInFlight += 1;
  runAsync(res, '登录', () => loginTask(req, res, body))
    .finally(() => { loginInFlight -= 1; });
}

async function loginTask(req, res, body) {
  const username = toText(body && body.username);
  const password = typeof (body && body.password) === 'string' ? body.password : '';
  if (!username || !password) return json(res, { error: '请输入用户名和密码' }, 400);
  // 超长密码直接拒绝，避免把超大输入交给哈希函数
  if (password.length > PASSWORD_MAX_LENGTH) return json(res, { error: '用户名或密码错误' }, 401);

  const key = `${clientIp(req)}|${username.toLowerCase()}`;
  const locked = loginFailureState(key);
  if (locked && locked.locked) {
    return json(res, { error: `登录失败次数过多，请 ${locked.seconds} 秒后再试` }, 429);
  }

  const user = db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE').get(username);
  const ok = !!user && Number(user.is_active) === 1 && await verifyPassword(password, user.password_hash);
  if (!ok) {
    recordLoginFailure(key);
    logWrite('WARN', `登录失败：${username} from ${clientIp(req)}`);
    return json(res, { error: '用户名或密码错误' }, 401);
  }

  loginFailures.delete(key);
  const token = createSession(user.id, req);
  db.prepare("UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?")
    .run(stampNow(), stampNow(), user.id);
  res.setHeader('Set-Cookie', sessionCookieHeader(token, SESSION_TTL_HOURS * 3600));
  logWrite('AUTH', `用户登录：${user.username}`);
  json(res, { success: true, user: authPayload({ ...user, last_login_at: stampNow() }), meta: authMeta() });
}

// POST /api/auth/logout - 退出登录
function logout(req, res) {
  const token = parseCookies(req.headers.cookie)[AUTH_COOKIE];
  destroySession(token);
  res.setHeader('Set-Cookie', sessionCookieHeader('', 0));
  json(res, { success: true });
}

// GET /api/auth/me - 当前登录用户（未登录返回 user: null，供前端判断是否展示登录按钮）
function getAuthMe(req, res) {
  const { user } = resolveAuth(req);
  json(res, { user: authPayload(user), meta: authMeta() });
}

// POST /api/auth/password - 修改自己的密码
function changeOwnPassword(req, res, body, user) {
  runAsync(res, '修改密码', () => changeOwnPasswordTask(req, res, body, user));
}

async function changeOwnPasswordTask(req, res, body, user) {
  const oldPassword = typeof (body && body.old_password) === 'string' ? body.old_password : '';
  const newPassword = typeof (body && body.new_password) === 'string' ? body.new_password : '';
  if (!oldPassword || !newPassword) return json(res, { error: '请填写原密码与新密码' }, 400);
  if (!isValidPasswordLength(newPassword)) {
    return json(res, { error: `新密码长度需在 ${PASSWORD_MIN_LENGTH} ~ ${PASSWORD_MAX_LENGTH} 位之间` }, 400);
  }
  if (newPassword === oldPassword) return json(res, { error: '新密码不能与原密码相同' }, 400);

  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
  if (!row || !(await verifyPassword(oldPassword, row.password_hash))) {
    return json(res, { error: '原密码不正确' }, 400);
  }
  const passwordHash = await hashPassword(newPassword);
  db.prepare("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?")
    .run(passwordHash, stampNow(), user.id);

  // 保留当前会话，踢掉该账号其它会话
  const token = parseCookies(req.headers.cookie)[AUTH_COOKIE];
  db.prepare('DELETE FROM user_sessions WHERE user_id = ? AND token <> ?').run(user.id, token || '');
  logWrite('AUTH', `用户修改密码：${row.username}`);
  json(res, { success: true });
}

// GET /api/auth/users - 用户列表（仅用户权限模块可见）
function getUsers(req, res) {
  const rows = db.prepare(`
    SELECT id, username, display_name, role, display_pages, admin_pages, actions,
           is_active, last_login_at, created_at, updated_at
    FROM users ORDER BY role = 'super' DESC, id ASC
  `).all();
  json(res, {
    users: rows.map((r) => ({ ...authPayload(r), is_active: Number(r.is_active) })),
    total: rows.length,
  });
}

function normalizeUserAssignments(payload) {
  return {
    display_pages: sanitizeAssignments(payload.display_pages, DISPLAY_PAGE_KEYS),
    admin_pages: sanitizeAssignments(payload.admin_pages, ADMIN_PAGE_KEYS),
    actions: sanitizeAssignments(payload.actions, ALL_ACTION_KEYS),
  };
}

// 动作权限必须依附于所属模块页面：没有分配该模块（看板或后台任一端）时，其下的按钮动作不生效
function pruneActionsByPages(assign) {
  const modules = new Set([...(assign.display_pages || []), ...(assign.admin_pages || [])]);
  return {
    display_pages: assign.display_pages || [],
    admin_pages: assign.admin_pages || [],
    actions: (assign.actions || []).filter((key) => modules.has(String(key).split(':')[0])),
  };
}

// 非超级管理员不得授予超管角色 / 用户权限页面 / 用户管理动作，防止越权提权
function clampAssignmentsForOperator(assign, role, operator) {
  if (isSuperUser(operator)) return { assign, role };
  return {
    role: 'normal',
    assign: {
      display_pages: assign.display_pages,
      admin_pages: assign.admin_pages.filter((k) => k !== 'user'),
      actions: assign.actions.filter((k) => !k.startsWith('user:')),
    },
  };
}

function activeSuperCount(excludeId = 0) {
  return db.prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'super' AND is_active = 1 AND id <> ?")
    .get(excludeId).c;
}

// POST /api/auth/users/create - 新增用户
function createUser(req, res, body, operator) {
  runAsync(res, '新增用户', () => createUserTask(req, res, body, operator));
}

async function createUserTask(req, res, body, operator) {
  const username = toText(body && body.username);
  const displayName = toText(body && body.display_name) || username;
  const password = typeof (body && body.password) === 'string' ? body.password : '';
  let role = body && body.role === 'super' ? 'super' : 'normal';
  if (!username) return json(res, { error: '缺少用户名' }, 400);
  if (!/^[A-Za-z0-9_.-]{3,32}$/.test(username)) {
    return json(res, { error: '用户名只能包含字母、数字、下划线、点和短横线，长度 3-32' }, 400);
  }
  // 不再回落到全局默认密码：新建账号必须显式设置初始密码
  if (!password) return json(res, { error: '请设置初始密码' }, 400);
  if (!isValidPasswordLength(password)) {
    return json(res, { error: `密码长度需在 ${PASSWORD_MIN_LENGTH} ~ ${PASSWORD_MAX_LENGTH} 位之间` }, 400);
  }
  if (db.prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE').get(username)) {
    return json(res, { error: `用户名 ${username} 已存在` }, 400);
  }

  let assign = normalizeUserAssignments(body || {});
  ({ assign, role } = clampAssignmentsForOperator(assign, role, operator));
  // 未分配的模块不保留其下动作，避免出现「无页面却有按钮权限」的悬空授权
  assign = pruneActionsByPages(assign);
  const passwordHash = await hashPassword(password);
  const info = db.prepare(`
    INSERT INTO users (username, display_name, password_hash, role, display_pages, admin_pages, actions, is_active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    username, displayName, passwordHash, role,
    JSON.stringify(assign.display_pages), JSON.stringify(assign.admin_pages), JSON.stringify(assign.actions),
    body && body.is_active != null ? (Number(body.is_active) ? 1 : 0) : 1
  );

  addStandardLogSafe('AUTH', `新增用户 ${username}`, operatorName(req));
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
  json(res, { success: true, user: authPayload(row) });
}

// POST /api/auth/users/update - 修改用户（含密码重置、页面与动作授权）
function updateUser(req, res, body, operator) {
  runAsync(res, '修改用户', () => updateUserTask(req, res, body, operator));
}

async function updateUserTask(req, res, body, operator) {
  const id = Number(body && body.id);
  const row = Number.isSafeInteger(id) && id > 0 ? db.prepare('SELECT * FROM users WHERE id = ?').get(id) : null;
  if (!row) return json(res, { error: '用户不存在' }, 404);

  // 非超级管理员不得修改超级管理员账号
  if (isSuperUser(row) && !isSuperUser(operator)) {
    return json(res, { error: '只有超级管理员可以修改超级管理员账号' }, 403);
  }
  // 非超管同样不得修改其他管理员账号（防止同级相互重置密码接管）
  if (!isSuperUser(operator) && isUserManager(row) && Number(operator && operator.id) !== id) {
    return json(res, { error: '无权修改其他管理员账号' }, 403);
  }

  const isSelf = operator && Number(operator.id) === id;
  let nextRole = body && body.role === 'super' ? 'super' : (body && body.role === 'normal' ? 'normal' : row.role);
  const nextActive = body && body.is_active != null ? (Number(body.is_active) ? 1 : 0) : Number(row.is_active);

  if (row.role === 'super' && (nextRole !== 'super' || nextActive !== 1) && activeSuperCount(id) === 0) {
    return json(res, { error: '至少保留一个启用的超级管理员' }, 400);
  }
  if (isSelf && (nextRole !== 'super' || nextActive !== 1)) {
    return json(res, { error: '不能降级或停用当前登录账号' }, 400);
  }

  const username = body && body.username != null ? toText(body.username) : row.username;
  if (!/^[A-Za-z0-9_.-]{3,32}$/.test(username)) {
    return json(res, { error: '用户名只能包含字母、数字、下划线、点和短横线，长度 3-32' }, 400);
  }
  const dup = db.prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE AND id <> ?').get(username, id);
  if (dup) return json(res, { error: `用户名 ${username} 已存在` }, 400);

  let assign = body && (body.display_pages !== undefined || body.admin_pages !== undefined || body.actions !== undefined)
    ? normalizeUserAssignments({
      display_pages: body.display_pages !== undefined ? body.display_pages : parseJsonList(row.display_pages),
      admin_pages: body.admin_pages !== undefined ? body.admin_pages : parseJsonList(row.admin_pages),
      actions: body.actions !== undefined ? body.actions : parseJsonList(row.actions),
    })
    : {
      display_pages: parseJsonList(row.display_pages),
      admin_pages: parseJsonList(row.admin_pages),
      actions: parseJsonList(row.actions),
    };
  ({ assign, role: nextRole } = clampAssignmentsForOperator(assign, nextRole, operator));
  // 取消某模块页面时，同步回收其下的按钮动作
  assign = pruneActionsByPages(assign);

  let passwordHash = row.password_hash;
  if (typeof (body && body.password) === 'string' && body.password) {
    if (!isValidPasswordLength(body.password)) {
      return json(res, { error: `密码长度需在 ${PASSWORD_MIN_LENGTH} ~ ${PASSWORD_MAX_LENGTH} 位之间` }, 400);
    }
    passwordHash = await hashPassword(body.password);
  }

  db.prepare(`
    UPDATE users
    SET username = ?, display_name = ?, password_hash = ?, role = ?,
        display_pages = ?, admin_pages = ?, actions = ?, is_active = ?, updated_at = ?
    WHERE id = ?
  `).run(
    username,
    body && body.display_name != null ? toText(body.display_name) : (row.display_name || row.username),
    passwordHash, nextRole,
    JSON.stringify(assign.display_pages), JSON.stringify(assign.admin_pages), JSON.stringify(assign.actions),
    nextActive, stampNow(), id
  );

  // 停用或改密后，清理该用户的其它会话，避免旧会话继续可用
  if (nextActive !== 1 || passwordHash !== row.password_hash) {
    db.prepare('DELETE FROM user_sessions WHERE user_id = ?').run(id);
  }

  addStandardLogSafe('AUTH', `修改用户 ${username}`, operatorName(req));
  const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  json(res, { success: true, user: authPayload(updated) });
}

// POST /api/auth/users/delete - 删除用户
function deleteUser(req, res, body, operator) {
  const id = Number(body && body.id);
  const row = Number.isSafeInteger(id) && id > 0 ? db.prepare('SELECT * FROM users WHERE id = ?').get(id) : null;
  if (!row) return json(res, { error: '用户不存在' }, 404);
  if (operator && Number(operator.id) === id) return json(res, { error: '不能删除当前登录账号' }, 400);
  if (row.role === 'super' && !isSuperUser(operator)) {
    return json(res, { error: '只有超级管理员可以删除超级管理员账号' }, 403);
  }
  // 非超管不得删除其他管理员账号（含拥有用户管理权限的普通账号）
  if (!isSuperUser(operator) && isUserManager(row)) {
    return json(res, { error: '无权删除管理员账号' }, 403);
  }
  if (row.role === 'super' && activeSuperCount(id) === 0) {
    return json(res, { error: '至少保留一个启用的超级管理员' }, 400);
  }

  db.prepare('DELETE FROM user_sessions WHERE user_id = ?').run(id);
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  addStandardLogSafe('AUTH', `删除用户 ${row.username}`, operatorName(req));
  json(res, { success: true });
}

// 审计日志：写入系统日志表（兼容未初始化日志表的环境）
// operator 由调用方传入登录用户名，避免审计主体被请求体伪造
function addStandardLogSafe(action, content, operator = 'system') {
  try {
    if (!tableExists('analysis_standard_logs')) return;
    db.prepare(`
      INSERT INTO analysis_standard_logs (version_id, version_code, action, target, content, operator)
      VALUES (NULL, '', ?, '', ?, ?)
    `).run(action, content, String(operator || 'system').slice(0, 64));
  } catch {
    // 审计失败不影响主流程
  }
}

// ==================== HTTP 服务器 ====================
// 跨域头：仅在配置 CORS_ORIGIN 白名单后下发，默认同源部署不开放跨域
function corsHeaders(origin) {
  if (!CORS_ORIGIN) return {};
  const allow = CORS_ORIGIN.split(',').map((s) => s.trim()).filter(Boolean);
  if (!allow.length) return {};
  if (allow.includes('*')) return { 'Access-Control-Allow-Origin': '*' };
  if (allow.includes(origin)) return { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' };
  return {};
}

// 接口鉴权：公开接口放行；其余要求登录，写接口再校验按钮动作权限
function guardApiRequest(req, res, pathname) {
  if (!pathname.startsWith('/api/')) return true;
  if (PUBLIC_API_PATHS.has(pathname)) return true;

  const auth = resolveAuth(req);
  req.user = auth.user;
  req.authSource = auth.source;

  if (!auth.user) {
    json(res, { error: '请先登录' }, 401);
    return false;
  }
  // 基于 Cookie 的写请求做同源校验，降低 CSRF 风险（机器令牌不受限）
  if (req.method === 'POST' && auth.source === 'session' && !sameOriginRequest(req)) {
    json(res, { error: '跨站请求被拒绝' }, 403);
    return false;
  }
  if (req.method === 'POST') {
    const perm = findWritePermission(pathname);
    if (perm && !userCanAction(auth.user, perm.module, perm.action)) {
      json(res, { error: `无操作权限（${perm.module}:${perm.action}）` }, 403);
      return false;
    }
    return true;
  }
  if (req.method === 'GET' || req.method === 'HEAD') {
    const modules = findReadModules(pathname);
    if (modules && !userCanRead(auth.user, modules)) {
      json(res, { error: '无权访问该模块数据' }, 403);
      return false;
    }
  }
  return true;
}

// 请求入口：解析 URL 与鉴权。整段由 createServer 外层 try/catch 兜底，
// 避免畸形 URL / Cookie 等输入抛异常后请求悬挂（全局 uncaughtException 不会自动响应）
function handleIncoming(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname;

  const cors = corsHeaders(req.headers.origin || '');
  for (const [key, value] of Object.entries(cors)) res.setHeader(key, value);

  // CORS 预检
  if (req.method === 'OPTIONS') {
    if (!Object.keys(cors).length) {
      res.writeHead(204);
      res.end();
      return;
    }
    res.writeHead(204, {
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Token',
      'Access-Control-Max-Age': '600',
    });
    res.end();
    return;
  }

  // 登录与权限校验（公开接口：健康检查 / 登录 / 会话查询 / 看板首页数据）
  if (!guardApiRequest(req, res, pathname)) return;

  // POST 请求体解析（限制大小，防止超大 body 耗尽内存）
  if (req.method === 'POST') {
    const chunks = [];
    let size = 0;
    let aborted = false;
    req.on('data', (chunk) => {
      if (aborted) return;
      size += chunk.length; // 按字节累加，避免每块都全量计算字符串长度
      if (size > MAX_BODY_BYTES) {
        aborted = true;
        json(res, { error: `请求体超过 ${MAX_BODY_BYTES} 字节上限` }, 413);
        return;
      }
      chunks.push(chunk);
    });
    req.on('error', () => {
      aborted = true;
    });
    req.on('aborted', () => {
      aborted = true;
    });
    req.on('end', () => {
      if (aborted) return;
      const body = Buffer.concat(chunks).toString('utf8');
      let parsed;
      try {
        parsed = JSON.parse(body || '{}');
      } catch {
        json(res, { error: '请求体不是合法 JSON' }, 400);
        return;
      }
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        json(res, { error: '请求体必须是 JSON 对象' }, 400);
        return;
      }
      handleRoute(req, res, pathname, parsed);
    });
    return;
  }

  handleRoute(req, res, pathname, null);
}

const server = http.createServer((req, res) => {
  try {
    handleIncoming(req, res);
  } catch (err) {
    logWrite('ERROR', `${req.method} ${req.url} 请求入口异常: ${err && err.stack ? err.stack : err}`);
    if (!res.headersSent) {
      json(res, { error: '服务器内部错误，请联系管理员查看服务日志' }, 500);
    } else {
      try { res.end(); } catch { /* 忽略重复结束 */ }
    }
  }
});

// 连接级超时：避免慢速请求长期占用连接（slowloris）
server.headersTimeout = 20000;
server.requestTimeout = 30000;
server.keepAliveTimeout = 5000;

server.on('clientError', (err, socket) => {
  if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
});

server.on('error', (err) => {
  logWrite('ERROR', `服务启动失败: ${err && err.message ? err.message : err}`);
  process.exit(1);
});

// 优雅退出：停止接收新连接并关闭数据库（触发 WAL checkpoint）
let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logWrite('SYSTEM', `收到 ${signal}，开始优雅退出`);
  const finish = () => {
    try { db.close(); } catch { /* 忽略关闭异常 */ }
    process.exit(0);
  };
  server.close(finish);
  const timer = setTimeout(finish, 5000);
  if (timer.unref) timer.unref();
}

['SIGINT', 'SIGTERM'].forEach((signal) => {
  process.on(signal, () => shutdown(signal));
});

// 路由异常兜底：业务异常返回 500，进程不中断
function handleRoute(req, res, pathname, body) {
  res._reqMethod = req.method;
  res._reqPath = pathname;
  try {
    routeRequest(req, res, pathname, body);
  } catch (err) {
    logWrite('ERROR', `${req.method} ${pathname} 处理失败: ${err && err.stack ? err.stack : err}`);
    if (!res.headersSent) {
      json(res, { error: '服务器内部错误，请联系管理员查看服务日志' }, 500);
    } else {
      try { res.end(); } catch { /* 忽略重复结束 */ }
    }
  }
}

// 只读接口 / 只写接口清单：用于对「方法不匹配」返回 405，而不是落到静态兜底
const API_GET_ONLY = new Set([
  '/health',
  '/api/devices/overview', '/api/devices/alarm-log', '/api/devices/list', '/api/devices/options',
  '/api/products/list', '/api/products/options',
  '/api/thermal/config', '/api/thermal/latest',
  '/api/molds/list', '/api/molds/options',
  '/api/recipes', '/api/recipes/list', '/api/recipes/export', '/api/recipes/options',
  '/api/pipeline',
  '/api/andon/types', '/api/andon/calls', '/api/andon/logs',
  '/api/process/data', '/api/process/filters', '/api/process/params', '/api/process/chart', '/api/process/export',
  '/api/analysis/data', '/api/analysis/filters', '/api/analysis/standards', '/api/analysis/params',
  '/api/analysis/standard-logs', '/api/analysis/versions',
  '/api/stats/list', '/api/stats/export', '/api/stats/shifts',
  '/api/plans/list', '/api/plans/export', '/api/plans/options', '/api/plans/logs', '/api/plans/records',
  '/api/auth/me', '/api/auth/meta', '/api/auth/users',
]);

const API_POST_ONLY = new Set([
  '/api/auth/login', '/api/auth/logout', '/api/auth/password',
  '/api/auth/users/create', '/api/auth/users/update', '/api/auth/users/delete',
  '/api/devices/create', '/api/devices/update', '/api/devices/delete',
  '/api/products/create', '/api/products/update', '/api/products/delete',
  '/api/molds/create', '/api/molds/update', '/api/molds/delete',
  '/api/recipes/create', '/api/recipes/update', '/api/recipes/delete',
  '/api/pipeline/update',
  '/api/andon/call', '/api/andon/respond', '/api/andon/complete',
  '/api/analysis/versions/create', '/api/analysis/versions/update', '/api/analysis/versions/delete',
  '/api/analysis/standards/create', '/api/analysis/standards/update', '/api/analysis/standards/delete',
  '/api/analysis/standards/reorder',
  '/api/stats/shifts/create', '/api/stats/shifts/update', '/api/stats/shifts/delete',
  '/api/stats/shifts/init', '/api/stats/rebuild',
  '/api/plans/create', '/api/plans/update', '/api/plans/status', '/api/plans/delete',
]);

function routeRequest(req, res, pathname, body) {
  // 仅 API 路由记录请求日志
  if (pathname.startsWith('/api/')) {
    logRequest(req.method, pathname, body);
  }

  // 健康检查（探活监控）
  if (pathname === '/health') return healthCheck(req, res);

  // 方法不匹配：明确返回 405，避免被静态兜底伪装成 200 HTML
  if (API_POST_ONLY.has(pathname) && req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return json(res, { error: `${pathname} 仅支持 POST 请求` }, 405);
  }
  if (API_GET_ONLY.has(pathname) && req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return json(res, { error: `${pathname} 仅支持 GET 请求` }, 405);
  }

  // 登录 / 会话 / 用户权限
  if (pathname === '/api/auth/login') return login(req, res, body);
  if (pathname === '/api/auth/logout') return logout(req, res);
  if (pathname === '/api/auth/me') return getAuthMe(req, res);
  if (pathname === '/api/auth/meta') return json(res, authMeta());
  if (pathname === '/api/auth/password' && req.method === 'POST') return changeOwnPassword(req, res, body, req.user || { id: 0 });
  if (pathname === '/api/auth/users') return getUsers(req, res);
  if (pathname === '/api/auth/users/create' && req.method === 'POST') return createUser(req, res, body, req.user);
  if (pathname === '/api/auth/users/update' && req.method === 'POST') return updateUser(req, res, body, req.user);
  if (pathname === '/api/auth/users/delete' && req.method === 'POST') return deleteUser(req, res, body, req.user);

  // API 路由
  if (pathname === '/api/devices/overview') return getDeviceOverview(req, res);
  if (pathname === '/api/devices/alarm-log') return getDeviceAlarmByName(req, res);

  // 设备管理
  if (pathname === '/api/devices/list') return getDeviceList(req, res);
  if (pathname === '/api/devices/options') return getDeviceOptions(req, res);
  if (pathname === '/api/devices/create' && req.method === 'POST') return createDevice(req, res, body);
  if (pathname === '/api/devices/update' && req.method === 'POST') return updateDevice(req, res, body);
  if (pathname === '/api/devices/delete' && req.method === 'POST') return deleteDevice(req, res, body);

  // 产品基础数据
  if (pathname === '/api/products/list') return getProductList(req, res);
  if (pathname === '/api/products/options') return getProductOptions(req, res);
  if (pathname === '/api/products/create' && req.method === 'POST') return createProduct(req, res, body);
  if (pathname === '/api/products/update' && req.method === 'POST') return updateProduct(req, res, body);
  if (pathname === '/api/products/delete' && req.method === 'POST') return deleteProduct(req, res, body);

  // 热成像
  if (pathname === '/api/thermal/config') return getThermalConfig(req, res);
  if (pathname === '/api/thermal/latest') return getThermalLatest(req, res);

  // 模具档案
  if (pathname === '/api/molds/list') return getMoldList(req, res);
  if (pathname === '/api/molds/options') return getMoldOptions(req, res);
  if (pathname === '/api/molds/create' && req.method === 'POST') return createMold(req, res, body);
  if (pathname === '/api/molds/update' && req.method === 'POST') return updateMold(req, res, body);
  if (pathname === '/api/molds/delete' && req.method === 'POST') return deleteMold(req, res, body);

  // 模具配方
  if (pathname === '/api/recipes') return searchRecipes(req, res);
  if (pathname === '/api/recipes/list') return listRecipes(req, res);
  if (pathname === '/api/recipes/export') return exportRecipes(req, res);
  if (pathname === '/api/recipes/options') return getRecipeOptions(req, res);
  if (pathname === '/api/recipes/create' && req.method === 'POST') return createRecipe(req, res, body);
  if (pathname === '/api/recipes/update' && req.method === 'POST') return updateRecipe(req, res, body);
  if (pathname === '/api/recipes/delete' && req.method === 'POST') return deleteRecipe(req, res, body);

  // 管路数据
  if (pathname === '/api/pipeline' && req.method === 'GET') return getPipeline(req, res);
  if (pathname === '/api/pipeline/update' && req.method === 'POST') return updatePipeline(req, res, body);

  // 安灯呼叫
  if (pathname === '/api/andon/types') return getAndonTypes(req, res);
  if (pathname === '/api/andon/calls') return getAndonCalls(req, res);
  if (pathname === '/api/andon/call' && req.method === 'POST') return createAndonCall(req, res, body);
  if (pathname === '/api/andon/respond' && req.method === 'POST') return respondAndonCall(req, res, body);
  if (pathname === '/api/andon/complete' && req.method === 'POST') return completeAndonCall(req, res, body);
  if (pathname === '/api/andon/logs') return getAndonLogs(req, res);

  // 工艺数据
  if (pathname === '/api/process/data') return getProcessData(req, res);
  if (pathname === '/api/process/filters') return getProcessFilters(req, res);
  if (pathname === '/api/process/params') return getProcessParams(req, res);
  if (pathname === '/api/process/chart') return getProcessChart(req, res);
  if (pathname === '/api/process/export') return exportProcessData(req, res);

  // 工件分析（数据来源：process_data）
  if (pathname === '/api/analysis/data') return getAnalysisData(req, res);
  if (pathname === '/api/analysis/filters') return getAnalysisFilters(req, res);
  if (pathname === '/api/analysis/standards') return getAnalysisStandards(req, res);
  if (pathname === '/api/analysis/params') return getAnalysisParams(req, res);
  if (pathname === '/api/analysis/standard-logs') return getAnalysisStandardLogs(req, res);
  if (pathname === '/api/analysis/versions') return getAnalysisVersions(req, res);
  if (pathname === '/api/analysis/versions/create' && req.method === 'POST') return createAnalysisVersion(req, res, body);
  if (pathname === '/api/analysis/versions/update' && req.method === 'POST') return updateAnalysisVersion(req, res, body);
  if (pathname === '/api/analysis/versions/delete' && req.method === 'POST') return deleteAnalysisVersion(req, res, body);
  if (pathname === '/api/analysis/standards/create' && req.method === 'POST') return createAnalysisStandard(req, res, body);
  if (pathname === '/api/analysis/standards/update' && req.method === 'POST') return updateAnalysisStandard(req, res, body);
  if (pathname === '/api/analysis/standards/delete' && req.method === 'POST') return deleteAnalysisStandard(req, res, body);
  if (pathname === '/api/analysis/standards/reorder' && req.method === 'POST') return reorderAnalysisStandards(req, res, body);

  // 生产统计
  if (pathname === '/api/stats/list') return getProductionStats(req, res);
  if (pathname === '/api/stats/export') return exportProductionStats(req, res);
  if (pathname === '/api/stats/shifts') return getShiftConfigs(req, res);
  if (pathname === '/api/stats/shifts/create' && req.method === 'POST') return createShiftConfig(req, res, body);
  if (pathname === '/api/stats/shifts/update' && req.method === 'POST') return updateShiftConfig(req, res, body);
  if (pathname === '/api/stats/shifts/delete' && req.method === 'POST') return deleteShiftConfig(req, res, body);
  if (pathname === '/api/stats/shifts/init' && req.method === 'POST') return initShiftConfigs(req, res);
  if (pathname === '/api/stats/rebuild' && req.method === 'POST') return rebuildProductionStats(req, res, body);

  // 生产计划
  if (pathname === '/api/plans/list') return getPlans(req, res);
  if (pathname === '/api/plans/export') return exportPlans(req, res);
  if (pathname === '/api/plans/options') return getPlanOptions(req, res);
  if (pathname === '/api/plans/logs') return getPlanLogs(req, res);
  if (pathname === '/api/plans/records') return getPlanRecords(req, res);
  if (pathname === '/api/plans/create' && req.method === 'POST') return createPlan(req, res, body);
  if (pathname === '/api/plans/update' && req.method === 'POST') return updatePlan(req, res, body);
  if (pathname === '/api/plans/status' && req.method === 'POST') return updatePlanStatus(req, res, body);
  if (pathname === '/api/plans/delete' && req.method === 'POST') return deletePlan(req, res, body);

  // 未注册的 API 路径统一 404 JSON（不再回退到 index.html）
  if (pathname === '/api' || pathname.startsWith('/api/')) {
    return json(res, { error: `接口不存在：${pathname}` }, 404);
  }

  // 静态文件
  serveStatic(req, res);
}

// ==================== 产品生产统计模块 ====================
// 统计口径：按「日期 + 班次 + 设备」汇总 process_data 记录数（一条工艺记录 = 一件产出）
// 质量数取自 process_data.data_status（normal→合格 / warning→预警 / unqualified→不合格）
// 未配置班次时按天统计（shift_code = ''）；配置班次后按班次统计，跨天班次自动归属到开始日

function pad2(n) {
  return String(n).padStart(2, '0');
}

function formatDateStr(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function parseDateStr(value) {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(String(value || '').trim());
  if (!m) return null;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  // 严格日历校验：2026-02-31 这类会被 Date 自动进位的日期视为非法
  if (!isValidDateParts(year, month, day)) return null;
  return new Date(year, month - 1, day);
}

function addDays(dateStr, n) {
  const d = parseDateStr(dateStr);
  if (!d) return '';
  d.setDate(d.getDate() + n);
  return formatDateStr(d);
}

function listDates(from, to, limit = 400) {
  const dates = [];
  let cur = from;
  while (cur && cur <= to && dates.length < limit) {
    dates.push(cur);
    cur = addDays(cur, 1);
  }
  return dates;
}

function activeShifts() {
  return db.prepare('SELECT * FROM shift_config WHERE is_active = 1 ORDER BY sort_order, id').all();
}

// 判断某条工艺记录归属的统计日期与班次
function resolveShiftBucket(shifts, collectTime) {
  const datePart = String(collectTime).slice(0, 10);
  const hhmm = String(collectTime).slice(11, 16);
  if (!shifts.length) return { date: datePart, code: '', name: '全天' };

  for (const s of shifts) {
    const start = s.start_time;
    const end = s.end_time;
    if (!start || !end || start === end) continue;
    if (start < end) {
      if (hhmm >= start && hhmm < end) {
        return { date: datePart, code: s.shift_code, name: s.shift_name };
      }
    } else {
      // 跨天班次：开始时间之后算当天，结束时间之前算前一天
      if (hhmm >= start) return { date: datePart, code: s.shift_code, name: s.shift_name };
      if (hhmm < end) {
        return { date: addDays(datePart, -1), code: s.shift_code, name: s.shift_name };
      }
    }
  }
  // 未落在任何班次区间内（班次之间有空档）的记录
  return { date: datePart, code: 'UNASSIGNED', name: '未分班' };
}

// 把单条工艺记录累加到「日期 × 班次 × 设备」聚合项
function addStatRow(map, row, shifts) {
  const bucket = resolveShiftBucket(shifts, row.collect_time);
  const key = `${bucket.date}|${bucket.code}|${row.device_code}`;
  let item = map.get(key);
  if (!item) {
    item = {
      stat_date: bucket.date,
      shift_code: bucket.code,
      shift_name: bucket.name,
      device_code: row.device_code,
      total_count: 0,
      qualified_count: 0,
      warning_count: 0,
      unqualified_count: 0,
    };
    map.set(key, item);
  }
  item.total_count += 1;
  if (row.data_status === 'normal') item.qualified_count += 1;
  else if (row.data_status === 'warning') item.warning_count += 1;
  else item.unqualified_count += 1;
  return item;
}

// 把 process_data 记录聚合为「日期 × 班次 × 设备」统计行
// 统计行完全由工艺数据派生：没有来源记录的日期/班次/设备不生成行
function aggregateStats(rows, shifts) {
  const map = new Map();
  rows.forEach((row) => addStatRow(map, row, shifts));
  return map;
}

// 按「日」分批查询并聚合：峰值内存只与单日记录数相关，避免大区间一次性读入
function aggregateDates(dates) {
  const shifts = activeShifts();
  const active = activeDeviceCodeSet();
  const statsMap = new Map();
  const inactive = new Set();
  let picked = 0;
  let skipped = 0;
  const stmt = db.prepare(`
    SELECT collect_time, device_code, data_status
    FROM process_data
    WHERE collect_time >= ? AND collect_time <= ?
  `);

  for (const day of dates) {
    // 多取前后各一天覆盖跨天班次，再按归属日期过滤，避免相邻批次重复计数
    const rows = stmt.all(`${addDays(day, -1)} 00:00:00`, `${addDays(day, 1)} 23:59:59`);
    for (const row of rows) {
      if (resolveShiftBucket(shifts, row.collect_time).date !== day) continue;
      if (active && !active.has(row.device_code)) {
        skipped += 1;
        inactive.add(row.device_code);
        continue;
      }
      picked += 1;
      addStatRow(statsMap, row, shifts);
    }
  }

  return { shifts, statsMap, picked, skipped, inactiveDevices: [...inactive].sort() };
}

function insertStats(statsMap) {
  const ins = db.prepare(`
    INSERT INTO production_stats
      (stat_date, shift_code, shift_name, device_code,
       total_count, qualified_count, warning_count, unqualified_count)
    VALUES (@stat_date, @shift_code, @shift_name, @device_code,
            @total_count, @qualified_count, @warning_count, @unqualified_count)
  `);
  statsMap.forEach(item => ins.run(item));
}

function statsSummary(statsMap, shifts, sourceRecords, extra = {}) {
  const items = [...statsMap.values()];
  const dates = [...new Set(items.map(i => i.stat_date))].sort();
  const devices = [...new Set(items.map(i => i.device_code))].sort();
  return {
    mode: shifts.length ? 'shift' : 'day',
    shiftCount: shifts.length,
    deviceCount: devices.length,
    dayCount: dates.length,
    rowCount: statsMap.size,
    sourceRecords,
    ...extra,
  };
}

// 已启用设备集合；设备表为空时返回 null（无从判断启用状态，不做过滤）
function activeDeviceCodeSet() {
  const total = db.prepare('SELECT COUNT(*) AS c FROM devices').get().c;
  if (!total) return null;
  const rows = db.prepare(`
    SELECT device_code FROM devices
    WHERE is_active = 1 AND device_code IS NOT NULL AND device_code <> ''
  `).all();
  return new Set(rows.map(r => r.device_code));
}

// 剔除未启用设备的记录：设备停用后不再产生统计记录
function filterActiveDevices(rows) {
  const active = activeDeviceCodeSet();
  if (!active) return { picked: rows, skipped: 0, inactiveDevices: [] };
  const picked = [];
  const inactive = new Set();
  rows.forEach((row) => {
    if (active.has(row.device_code)) picked.push(row);
    else inactive.add(row.device_code);
  });
  return { picked, skipped: rows.length - picked.length, inactiveDevices: [...inactive].sort() };
}

// 生成指定日期区间的产量统计（重复执行会覆盖对应区间）
function calcProductionStats(startDate, endDate) {
  const start = parseDateStr(startDate) ? formatDateStr(parseDateStr(startDate)) : '';
  const end = parseDateStr(endDate) ? formatDateStr(parseDateStr(endDate)) : '';
  if (!start || !end) throw new Error('日期格式应为 YYYY-MM-DD');
  if (end < start) throw new Error('结束日期不能早于开始日期');

  const dates = listDates(start, end);
  if (!dates.length) throw new Error('日期范围不合法');
  if (dates.length >= 400) throw new Error('单次统计范围不能超过 400 天');

  // 按日分批聚合：峰值内存只与单日记录数相关，避免大区间一次性读入
  const { shifts, statsMap, picked, skipped, inactiveDevices } = aggregateDates(dates);

  const del = db.prepare('DELETE FROM production_stats WHERE stat_date BETWEEN ? AND ?');
  const tx = db.transaction(() => {
    del.run(start, end);
    insertStats(statsMap);
  });
  tx();

  return {
    startDate: start,
    endDate: end,
    ...statsSummary(statsMap, shifts, picked),
    skippedRecords: skipped,
    inactiveDevices,
  };
}

// 全量重建：清空统计表，按 process_data 现有全部记录重新聚合
// 先取数据日期范围，再按日分批聚合，避免把全库工艺记录一次性读入内存
function rebuildAllProductionStats() {
  const range = db.prepare(`
    SELECT MIN(substr(collect_time, 1, 10)) AS start_date,
           MAX(substr(collect_time, 1, 10)) AS end_date
    FROM process_data
  `).get();
  const dates = range && range.start_date && range.end_date
    ? listDates(range.start_date, range.end_date, 10000)
    : [];

  const aggregated = dates.length
    ? aggregateDates(dates)
    : { shifts: activeShifts(), statsMap: new Map(), picked: 0, skipped: 0, inactiveDevices: [] };
  const { shifts, statsMap, picked, skipped, inactiveDevices } = aggregated;

  const tx = db.transaction(() => {
    db.prepare('DELETE FROM production_stats').run();
    insertStats(statsMap);
  });
  tx();

  const summary = statsSummary(statsMap, shifts, picked, {
    all: true,
    skippedRecords: skipped,
    inactiveDevices,
  });
  const statDates = [...new Set([...statsMap.values()].map(i => i.stat_date))].sort();
  return {
    startDate: statDates[0] || '',
    endDate: statDates[statDates.length - 1] || '',
    ...summary,
  };
}

// GET /api/stats/list - 生产统计查询
function getProductionStats(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const today = formatDateStr(new Date());
  const rawStart = (url.searchParams.get('startDate') || '').trim();
  const rawEnd = (url.searchParams.get('endDate') || '').trim();
  if (rawStart && !parseDateStr(rawStart)) return json(res, { error: '开始日期格式应为 YYYY-MM-DD' }, 400);
  if (rawEnd && !parseDateStr(rawEnd)) return json(res, { error: '结束日期格式应为 YYYY-MM-DD' }, 400);
  const startDate = rawStart ? formatDateStr(parseDateStr(rawStart)) : addDays(today, -6);
  const endDate = rawEnd ? formatDateStr(parseDateStr(rawEnd)) : today;
  if (startDate > endDate) return json(res, { error: '开始日期不能晚于结束日期' }, 400);
  const device = url.searchParams.get('device') || '';
  const shift = url.searchParams.get('shift');
  const { page, pageSize } = parsePaging(url, 20);

  let where = 'WHERE s.stat_date BETWEEN ? AND ?';
  const params = [startDate, endDate];
  if (device) { where += ' AND s.device_code = ?'; params.push(device); }
  if (shift !== null && shift !== undefined && shift !== '') {
    where += ' AND s.shift_code = ?';
    params.push(shift);
  }

  const summary = db.prepare(`
    SELECT
      COUNT(*) AS row_count,
      COALESCE(SUM(s.total_count), 0) AS total,
      COALESCE(SUM(s.qualified_count), 0) AS qualified,
      COALESCE(SUM(s.warning_count), 0) AS warning,
      COALESCE(SUM(s.unqualified_count), 0) AS unqualified
    FROM production_stats s
    ${where}
  `).get(...params);

  const total = summary.row_count;
  const offset = (page - 1) * pageSize;
  const rows = db.prepare(`
    SELECT s.*, d.device_name
    FROM production_stats s
    LEFT JOIN devices d ON d.device_code = s.device_code
    ${where}
    ORDER BY s.stat_date DESC,
             CASE WHEN s.shift_code = '' THEN '0' ELSE s.shift_code END,
             s.device_code
    LIMIT ? OFFSET ?
  `).all(...params, pageSize, offset);

  const shifts = activeShifts();
  const rates = (n) => (summary.total > 0 ? ((n / summary.total) * 100).toFixed(1) : '0.0');

  json(res, {
    startDate,
    endDate,
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    mode: shifts.length ? 'shift' : 'day',
    shifts,
    summary: {
      ...summary,
      qualifiedRate: rates(summary.qualified),
      unqualifiedRate: rates(summary.unqualified),
    },
    data: rows,
  });
}

// GET /api/stats/export - 生产统计导出（CSV）
// 时间规则：未指定起止日期时默认导出最近一个月
function exportProductionStats(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const win = exportDateWindow();
  const rawStart = (url.searchParams.get('startDate') || '').trim();
  const rawEnd = (url.searchParams.get('endDate') || '').trim();
  if (rawStart && !parseDateStr(rawStart)) return json(res, { error: '开始日期格式应为 YYYY-MM-DD' }, 400);
  if (rawEnd && !parseDateStr(rawEnd)) return json(res, { error: '结束日期格式应为 YYYY-MM-DD' }, 400);
  const startDate = rawStart ? formatDateStr(parseDateStr(rawStart)) : win.startDate;
  const endDate = rawEnd ? formatDateStr(parseDateStr(rawEnd)) : win.endDate;
  if (startDate > endDate) return json(res, { error: '开始日期不能晚于结束日期' }, 400);
  const device = url.searchParams.get('device') || '';
  const shift = url.searchParams.get('shift');

  let where = 'WHERE s.stat_date BETWEEN ? AND ?';
  const params = [startDate, endDate];
  if (device) { where += ' AND s.device_code = ?'; params.push(device); }
  if (shift !== null && shift !== undefined && shift !== '') {
    where += ' AND s.shift_code = ?';
    params.push(shift);
  }

  const rows = db.prepare(`
    SELECT s.*, d.device_name
    FROM production_stats s
    LEFT JOIN devices d ON d.device_code = s.device_code
    ${where}
    ORDER BY s.stat_date DESC,
             CASE WHEN s.shift_code = '' THEN '0' ELSE s.shift_code END,
             s.device_code
    LIMIT ${EXPORT_MAX_ROWS}
  `).all(...params);

  const shiftMap = new Map(activeShifts().map((s) => [s.shift_code, s.shift_name]));
  const headers = ['统计日期', '班次', '设备编号', '设备名称', '生产数', '合格数', '预警数', '不合格数', '合格率(%)'];
  const body = rows.map((r) => {
    const totalCount = Number(r.total_count) || 0;
    const qualified = Number(r.qualified_count) || 0;
    const rate = totalCount > 0 ? ((qualified / totalCount) * 100).toFixed(1) : '0.0';
    return [
      r.stat_date,
      r.shift_code ? (shiftMap.get(r.shift_code) || r.shift_code) : '未分班',
      r.device_code,
      r.device_name || '',
      totalCount,
      qualified,
      Number(r.warning_count) || 0,
      Number(r.unqualified_count) || 0,
      rate,
    ];
  });

  sendCsv(res, `生产统计_${startDate}_${endDate}_${exportStamp()}.csv`, headers, body);
}

// GET /api/stats/shifts - 班次配置
function getShiftConfigs(req, res) {
  const shifts = db.prepare('SELECT * FROM shift_config ORDER BY sort_order, id').all();
  const active = shifts.filter(s => Number(s.is_active) === 1);
  json(res, { shifts, mode: active.length ? 'shift' : 'day' });
}

// 班次时间区间：跨天班次拆成 [start, 24:00] + [00:00, end] 两段用于重叠判断
function shiftIntervals(start, end) {
  if (start < end) return [[start, end]];
  return [[start, '24:00'], ['00:00', end]];
}

function shiftsOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

function validateShift(body, excludeId, isActive = true) {
  const code = toText(body && body.shift_code);
  const name = toText(body && body.shift_name);
  const start = toText(body && body.start_time);
  const end = toText(body && body.end_time);
  if (!name) return { error: '缺少班次名称' };
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(start) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(end)) {
    return { error: '班次时间格式应为 HH:MM' };
  }
  if (start === end) return { error: '班次开始与结束时间不能相同' };
  if (code) {
    const dup = db.prepare('SELECT id FROM shift_config WHERE shift_code = ? AND id <> ?').get(code, excludeId || 0);
    if (dup) return { error: `班次编码 ${code} 已存在` };
  }

  // 启用的班次之间不允许时间重叠：重叠会导致统计归属「先匹配先得」，口径不确定
  if (isActive) {
    const others = db.prepare(`
      SELECT id, shift_code, shift_name, start_time, end_time
      FROM shift_config
      WHERE id <> ? AND COALESCE(is_active, 1) = 1
    `).all(excludeId || 0);
    const mine = shiftIntervals(start, end);
    for (const other of others) {
      const theirs = shiftIntervals(other.start_time, other.end_time);
      const hit = mine.some(([s1, e1]) => theirs.some(([s2, e2]) => shiftsOverlap(s1, e1, s2, e2)));
      if (hit) {
        return { error: `班次时间与【${other.shift_name}（${other.start_time}-${other.end_time}）】重叠，请调整后再保存` };
      }
    }
  }

  return { code, name, start, end };
}

// POST /api/stats/shifts/create - 新增班次
function createShiftConfig(req, res, body) {
  const isActive = body.is_active == null ? 1 : (Number(body.is_active) ? 1 : 0);
  const valid = validateShift(body, null, isActive === 1);
  if (valid.error) return json(res, { error: valid.error }, 400);

  let code = valid.code;
  if (!code) {
    let i = db.prepare('SELECT COUNT(*) AS c FROM shift_config').get().c + 1;
    do {
      code = `SHIFT${pad2(i)}`;
      i += 1;
    } while (db.prepare('SELECT id FROM shift_config WHERE shift_code = ?').get(code));
  }

  let sortOrder = shiftSortOrder(body.sort_order, null);
  if (sortOrder === null) return json(res, { error: '排序号必须为整数' }, 400);

  const info = db.prepare(`
    INSERT INTO shift_config (shift_code, shift_name, start_time, end_time, sort_order, is_active)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(code, valid.name, valid.start, valid.end, sortOrder, isActive);

  json(res, { success: true, shift: db.prepare('SELECT * FROM shift_config WHERE id = ?').get(info.lastInsertRowid) });
}

// 排序号：未提供时取 MAX+1；提供时必须为安全整数（避免 NaN 写成 NULL）
function shiftSortOrder(value, current) {
  if (value === null || value === undefined || value === '') {
    if (current !== null && current !== undefined) return current;
    return db.prepare('SELECT COALESCE(MAX(sort_order),0)+1 AS n FROM shift_config').get().n;
  }
  const num = toFiniteNumber(value);
  return num !== null && Number.isSafeInteger(num) ? num : null;
}

// POST /api/stats/shifts/update - 修改班次
function updateShiftConfig(req, res, body) {
  const id = Number(body && body.id);
  const shift = db.prepare('SELECT * FROM shift_config WHERE id = ?').get(id);
  if (!shift) return json(res, { error: '班次不存在' }, 404);

  const isActive = body.is_active != null ? (Number(body.is_active) ? 1 : 0) : shift.is_active;
  const merged = {
    shift_code: body.shift_code !== undefined ? body.shift_code : shift.shift_code,
    shift_name: body.shift_name !== undefined ? body.shift_name : shift.shift_name,
    start_time: body.start_time !== undefined ? body.start_time : shift.start_time,
    end_time: body.end_time !== undefined ? body.end_time : shift.end_time,
  };
  const valid = validateShift(merged, id, Number(isActive) === 1);
  if (valid.error) return json(res, { error: valid.error }, 400);
  const code = valid.code || shift.shift_code;

  const sortOrder = shiftSortOrder(body.sort_order, shift.sort_order);
  if (sortOrder === null) return json(res, { error: '排序号必须为整数' }, 400);

  db.prepare(`
    UPDATE shift_config
    SET shift_code = ?, shift_name = ?, start_time = ?, end_time = ?,
        sort_order = ?, is_active = ?, updated_at = datetime('now','localtime')
    WHERE id = ?
  `).run(code, valid.name, valid.start, valid.end, sortOrder, isActive, id);

  json(res, { success: true, shift: db.prepare('SELECT * FROM shift_config WHERE id = ?').get(id) });
}

// POST /api/stats/shifts/delete - 删除班次
//   已被统计数据引用时需显式传入 force=true，避免历史统计失去班次名称
function deleteShiftConfig(req, res, body) {
  const id = Number(body && body.id);
  const shift = db.prepare('SELECT * FROM shift_config WHERE id = ?').get(id);
  if (!shift) return json(res, { error: '班次不存在' }, 404);

  const used = tableExists('production_stats')
    ? db.prepare('SELECT COUNT(*) AS c FROM production_stats WHERE shift_code = ?').get(shift.shift_code).c
    : 0;
  const force = body && (body.force === true || body.force === 'true' || Number(body.force) === 1);
  if (used > 0 && !force) {
    return json(res, {
      error: `班次【${shift.shift_name}】已被 ${used} 条生产统计引用，删除后这些记录将失去班次配置；如确认删除请传入 force=true`,
    }, 400);
  }

  db.prepare('DELETE FROM shift_config WHERE id = ?').run(id);
  json(res, { success: true, affectedStats: used });
}

// POST /api/stats/shifts/init - 一键生成标准班次（白班 / 夜班）
function initShiftConfigs(req, res) {
  const defaults = [
    { code: 'DAY', name: '白班', start: '08:00', end: '20:00', order: 1 },
    { code: 'NIGHT', name: '夜班', start: '20:00', end: '08:00', order: 2 },
  ];
  const ins = db.prepare(`
    INSERT INTO shift_config (shift_code, shift_name, start_time, end_time, sort_order)
    VALUES (?, ?, ?, ?, ?)
  `);
  let created = 0;
  const tx = db.transaction(() => {
    defaults.forEach((d) => {
      if (db.prepare('SELECT id FROM shift_config WHERE shift_code = ?').get(d.code)) return;
      ins.run(d.code, d.name, d.start, d.end, d.order);
      created += 1;
    });
  });
  tx();
  json(res, { success: true, created });
}

// POST /api/stats/rebuild - 重新统计
// 默认按 body 的日期区间重算；body.all = true 时按 process_data 全部记录全量重建
function rebuildProductionStats(req, res, body) {
  const all = body && (body.all === true || body.all === 'true' || Number(body.all) === 1);
  try {
    if (all) {
      json(res, { success: true, ...rebuildAllProductionStats() });
      return;
    }
    const today = formatDateStr(new Date());
    const rawStart = toText(body && body.startDate);
    const rawEnd = toText(body && body.endDate);
    if (rawStart && !parseDateStr(rawStart)) return json(res, { error: '开始日期格式应为 YYYY-MM-DD' }, 400);
    if (rawEnd && !parseDateStr(rawEnd)) return json(res, { error: '结束日期格式应为 YYYY-MM-DD' }, 400);
    const startDate = rawStart ? formatDateStr(parseDateStr(rawStart)) : addDays(today, -1);
    const endDate = rawEnd ? formatDateStr(parseDateStr(rawEnd)) : today;
    if (startDate > endDate) return json(res, { error: '结束日期不能早于开始日期' }, 400);

    const result = calcProductionStats(startDate, endDate);
    json(res, { success: true, ...result });
  } catch (e) {
    logWrite('ERROR', `重新统计失败: ${e && e.stack ? e.stack : e}`);
    json(res, { error: '重新统计失败，请查看服务日志' }, 500);
  }
}

// ==================== 生产计划模块 ====================
// 计划完成度实时聚合 process_data：
//   完成数 = 该设备在 [start_time, end_time] 内的工艺记录数（一条记录 = 1 件产出）
//   计划指定了 product_model 时，只统计该产品的记录
//   与生产统计口径一致，不落库、每次查询实时计算，计划进行中即可看到进度

// 计划状态（完整流转：起草 → 下达 → 执行 ⇄ 暂停 → 完成 → 结案，另有取消）
const PLAN_STATUS = ['draft', 'issued', 'running', 'paused', 'completed', 'closed', 'cancelled'];

const PLAN_STATUS_TEXT = {
  draft: '起草中',
  issued: '已下达',
  running: '执行中',
  paused: '已暂停',
  completed: '已完成',
  closed: '已结案',
  cancelled: '已取消',
};

// 动作名（写流转日志用）
const PLAN_ACTION_TEXT = {
  issued: '下达',
  running: '开始执行',
  paused: '暂停',
  completed: '完成',
  closed: '结案',
  cancelled: '取消',
  draft: '撤回/恢复起草',
};

// 计划状态机：
//   draft     → issued / cancelled
//   issued    → running / draft(撤回) / cancelled
//   running   → paused / completed / cancelled
//   paused    → running(恢复) / cancelled
//   completed → closed
//   closed    → 终态
//   cancelled → draft(恢复起草)
const PLAN_TRANSITIONS = {
  draft: ['issued', 'cancelled'],
  issued: ['running', 'draft', 'cancelled'],
  running: ['paused', 'completed', 'cancelled'],
  paused: ['running', 'cancelled'],
  completed: ['closed'],
  closed: [],
  cancelled: ['draft'],
};

// 已下达后不可再修改排产要素（设备/产品/计划数/周期/编号），仅可改名称与备注
const PLAN_LOCKED_FIELDS = ['plan_code', 'device_code', 'product_model', 'plan_count', 'start_time', 'end_time'];

// 同设备执行区间冲突检测：同一设备同一时间段只允许一个计划执行（不同设备互不影响）
//   newStart ~ newEnd 为本计划即将占用的区间，otherEnd 取对方段的结束时间（未结束视为无限远）
function findPlanConflict(deviceCode, planId, newStart, newEnd) {
  return db.prepare(`
    SELECT p.id, p.plan_code, p.plan_name, p.status, s.started_at, s.ended_at
    FROM production_plan_segments s
    JOIN production_plans p ON p.id = s.plan_id
    WHERE p.device_code = ?
      AND p.id <> ?
      AND s.started_at <= ?
      AND COALESCE(s.ended_at, '9999-12-31 23:59:59') > ?
    ORDER BY s.started_at
    LIMIT 1
  `).get(deviceCode, planId, newEnd, newStart);
}

// 打开执行段（进入执行中，同一计划只保留一条未关闭的段）
function openPlanSegment(planId, at) {
  const opened = db.prepare(
    'SELECT id FROM production_plan_segments WHERE plan_id = ? AND ended_at IS NULL LIMIT 1'
  ).get(planId);
  if (opened) return;
  db.prepare('INSERT INTO production_plan_segments (plan_id, started_at) VALUES (?, ?)').run(planId, at);
}

// 关闭执行段（暂停 / 完成 / 取消）
function closePlanSegment(planId, at) {
  db.prepare(
    'UPDATE production_plan_segments SET ended_at = ? WHERE plan_id = ? AND ended_at IS NULL'
  ).run(at, planId);
}

// 清空执行段（撤回 / 恢复为起草后重新走流程）
function clearPlanSegments(planId) {
  db.prepare('DELETE FROM production_plan_segments WHERE plan_id = ?').run(planId);
}

function addPlanLog(planId, planCode, action, fromStatus, toStatus, operator, remark) {
  try {
    db.prepare(`
      INSERT INTO production_plan_logs
        (plan_id, plan_code, action, from_status, to_status, operator, remark)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(planId, planCode || '', action, fromStatus || '', toStatus || '',
      operator || '系统', remark || '');
  } catch (e) {
    logWrite('ERROR', `写入计划流转日志失败: ${e && e.message ? e.message : e}`);
  }
}

function planNow() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ` +
    `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

// 计划实际完成量（子查询），extra 为附加的 data_status 条件
// 与生产统计口径一致：设备停用后其记录不再计入计划完成数
// 计划完成数 = 各「执行段」内的工艺记录数之和
//   仅统计计划周期内、落在本条计划实际执行区间（production_plan_segments）里的记录，
//   因此暂停期间设备生产其他计划的产出不会计入本计划
function planCountSql(extra = '') {
  return `(SELECT COUNT(*) FROM process_data x
    WHERE x.device_code = p.device_code
      AND x.collect_time >= p.start_time
      AND x.collect_time <= p.end_time
      AND (p.product_model IS NULL OR p.product_model = '' OR x.product_model = p.product_model)
      AND EXISTS (SELECT 1 FROM devices dv WHERE dv.device_code = p.device_code AND dv.is_active = 1)
      AND EXISTS (SELECT 1 FROM production_plan_segments s
                  WHERE s.plan_id = p.id
                    AND x.collect_time >= s.started_at
                    AND x.collect_time <= COALESCE(s.ended_at, datetime('now','localtime')))${extra})`;
}

function planSelectFields() {
  return `
    p.*, d.device_name,
    -- 实际开始 / 结束时间以执行段为准，保证与完成数统计区间一致
    (SELECT MIN(s.started_at) FROM production_plan_segments s WHERE s.plan_id = p.id) AS exec_start_at,
    (CASE WHEN p.status IN ('completed', 'closed', 'cancelled')
          THEN (SELECT MAX(s.ended_at) FROM production_plan_segments s WHERE s.plan_id = p.id)
          ELSE NULL END) AS exec_end_at,
    ${planCountSql()} AS actual_count,
    ${planCountSql(" AND x.data_status = 'normal'")} AS qualified_count,
    ${planCountSql(" AND x.data_status = 'warning'")} AS warning_count,
    ${planCountSql(" AND x.data_status NOT IN ('normal','warning')")} AS unqualified_count
  `;
}

function decoratePlan(row, now) {
  const planCount = Number(row.plan_count) || 0;
  const actual = Number(row.actual_count) || 0;
  // 未结束的计划（已下达 / 执行中 / 暂停）超出计划结束时间即视为超期
  const open = ['issued', 'running', 'paused'].includes(row.status);
  return {
    ...row,
    status_text: PLAN_STATUS_TEXT[row.status] || row.status,
    rate: planCount > 0 ? Math.min(actual / planCount, 1) : 0,
    rate_percent: planCount > 0 ? Number(((actual / planCount) * 100).toFixed(1)) : 0,
    overdue: open && String(row.end_time) < now ? 1 : 0,
  };
}

function getPlanById(id) {
  const row = db.prepare(`
    SELECT ${planSelectFields()}
    FROM production_plans p
    LEFT JOIN devices d ON d.device_code = p.device_code
    WHERE p.id = ?
  `).get(id);
  return row ? decoratePlan(row, planNow()) : null;
}

// 把 datetime-local（2026-11-17T08:00）或 2026-11-17 08:00 统一为 YYYY-MM-DD HH:MM:SS
function normalizePlanTime(value) {
  const s = String(value == null ? '' : value).trim().replace('T', ' ');
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})[ ](\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(s);
  if (!m) return '';
  const [year, month, day, hour, minute, second] = [
    Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6] || 0),
  ];
  // 形状匹配后仍需校验日历范围，否则 2026-13-45 25:00 会污染排序与统计
  if (!isValidDateParts(year, month, day)) return '';
  if (hour > 23 || minute > 59 || second > 59) return '';
  const pad = n => String(n).padStart(2, '0');
  return `${year}-${pad(month)}-${pad(day)} ${pad(hour)}:${pad(minute)}:${pad(second)}`;
}

function nextPlanCode() {
  const prefix = `PLAN-${planNow().slice(0, 10).replace(/-/g, '')}`;
  let i = 1;
  while (db.prepare('SELECT id FROM production_plans WHERE plan_code = ?').get(`${prefix}-${String(i).padStart(3, '0')}`)) {
    i += 1;
  }
  return `${prefix}-${String(i).padStart(3, '0')}`;
}

// 计划数允许范围：避免 1e21 之类数值被 SQLite 存为 REAL（排序 / 完成率失真）
const PLAN_COUNT_MAX = 100000000;

function validatePlan(body) {
  const deviceCode = toText(body && body.device_code);
  const planCode = toText(body && body.plan_code);
  const planName = toText(body && body.plan_name);
  const productModel = toText(body && body.product_model);
  const planCount = toFiniteNumber(body && body.plan_count);
  const start = normalizePlanTime(body && body.start_time);
  const end = normalizePlanTime(body && body.end_time);
  // 新建计划一律从「起草」开始（状态只能通过 /api/plans/status 流转）
  const status = toText(body && body.status) || 'draft';
  const remark = toText(body && body.remark);

  if (!deviceCode) return { error: '请选择设备' };
  if (!db.prepare('SELECT id FROM devices WHERE device_code = ?').get(deviceCode)) {
    return { error: `设备编号 ${deviceCode} 不存在` };
  }
  if (planCount === null || !Number.isSafeInteger(planCount) || planCount <= 0 || planCount > PLAN_COUNT_MAX) {
    return { error: `计划数必须是 1 ~ ${PLAN_COUNT_MAX} 之间的整数` };
  }
  if (!start || !end) return { error: '计划时间格式应为 YYYY-MM-DD HH:MM，且必须是有效日期' };
  if (start >= end) return { error: '计划结束时间必须晚于开始时间' };
  if (!PLAN_STATUS.includes(status)) return { error: '计划状态不合法' };

  return { planCode, planName, deviceCode, productModel, planCount, start, end, status, remark };
}

// GET /api/plans/list - 计划列表（含实时完成量与汇总）
function getPlans(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const keyword = (url.searchParams.get('keyword') || '').trim();
  const device = (url.searchParams.get('device') || '').trim();
  const status = (url.searchParams.get('status') || '').trim();
  const startDate = (url.searchParams.get('startDate') || '').trim();
  const endDate = (url.searchParams.get('endDate') || '').trim();
  if (startDate && !parseDateStr(startDate)) return json(res, { error: '开始日期格式应为 YYYY-MM-DD' }, 400);
  if (endDate && !parseDateStr(endDate)) return json(res, { error: '结束日期格式应为 YYYY-MM-DD' }, 400);
  const { page, pageSize } = parsePaging(url, 20);

  let where = 'WHERE 1=1';
  const params = [];
  if (keyword) {
    where += ' AND (p.plan_code LIKE ? OR p.plan_name LIKE ? OR p.device_code LIKE ?)';
    params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
  }
  if (device) { where += ' AND p.device_code = ?'; params.push(device); }
  if (status) { where += ' AND p.status = ?'; params.push(status); }
  if (startDate) { where += ' AND p.start_time >= ?'; params.push(`${startDate} 00:00:00`); }
  if (endDate) { where += ' AND p.start_time <= ?'; params.push(`${endDate} 23:59:59`); }

  const now = planNow();

  // 汇总按状态分组聚合（不随分页变化），避免把全表读进内存再切片
  const statusRows = db.prepare(`
    SELECT p.status AS status, COUNT(*) AS cnt
    FROM production_plans p
    LEFT JOIN devices d ON d.device_code = p.device_code
    ${where}
    GROUP BY p.status
  `).all(...params);

  const summary = {
    total: 0,
    draft: 0,
    issued: 0,
    running: 0,
    paused: 0,
    completed: 0,
    closed: 0,
    cancelled: 0,
    runningPlanCount: 0,
    runningActualCount: 0,
    runningQualifiedCount: 0,
    runningRate: 0,
  };
  statusRows.forEach((r) => {
    const cnt = Number(r.cnt) || 0;
    summary.total += cnt;
    if (summary[r.status] !== undefined) summary[r.status] += cnt;
  });

  // 运行中计划的完成量单独聚合（只有 running 行需要跑相关子查询）
  const runningRows = db.prepare(`
    SELECT ${planSelectFields()}
    FROM production_plans p
    LEFT JOIN devices d ON d.device_code = p.device_code
    ${where} AND p.status = 'running'
  `).all(...params);
  runningRows.forEach((r) => {
    summary.runningPlanCount += Number(r.plan_count) || 0;
    summary.runningActualCount += Number(r.actual_count) || 0;
    summary.runningQualifiedCount += Number(r.qualified_count) || 0;
  });
  if (summary.runningPlanCount > 0) {
    summary.runningRate = Number(((summary.runningActualCount / summary.runningPlanCount) * 100).toFixed(1));
  }

  const total = summary.total;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);

  const data = db.prepare(`
    SELECT ${planSelectFields()}
    FROM production_plans p
    LEFT JOIN devices d ON d.device_code = p.device_code
    ${where}
    ORDER BY CASE p.status
               WHEN 'running' THEN 0 WHEN 'paused' THEN 1 WHEN 'issued' THEN 2
               WHEN 'draft' THEN 3 WHEN 'completed' THEN 4 WHEN 'closed' THEN 5 ELSE 6
             END,
             p.start_time DESC, p.id DESC
    LIMIT ? OFFSET ?
  `).all(...params, pageSize, (safePage - 1) * pageSize).map(r => decoratePlan(r, now));

  json(res, { total, page: safePage, pageSize, totalPages, summary, data });
}

// GET /api/plans/export - 生产计划导出（CSV）
// 时间规则：按计划开始时间过滤，未指定时默认导出最近一个月
function exportPlans(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const win = exportDateWindow();
  const rawStart = (url.searchParams.get('startDate') || '').trim();
  const rawEnd = (url.searchParams.get('endDate') || '').trim();
  if (rawStart && !parseDateStr(rawStart)) return json(res, { error: '开始日期格式应为 YYYY-MM-DD' }, 400);
  if (rawEnd && !parseDateStr(rawEnd)) return json(res, { error: '结束日期格式应为 YYYY-MM-DD' }, 400);
  const startDate = rawStart ? formatDateStr(parseDateStr(rawStart)) : win.startDate;
  const endDate = rawEnd ? formatDateStr(parseDateStr(rawEnd)) : win.endDate;
  if (startDate > endDate) return json(res, { error: '开始日期不能晚于结束日期' }, 400);
  const keyword = (url.searchParams.get('keyword') || '').trim();
  const device = (url.searchParams.get('device') || '').trim();
  const status = (url.searchParams.get('status') || '').trim();

  let where = 'WHERE p.start_time >= ? AND p.start_time <= ?';
  const params = [`${startDate} 00:00:00`, `${endDate} 23:59:59`];
  if (keyword) {
    where += ' AND (p.plan_code LIKE ? OR p.plan_name LIKE ? OR p.device_code LIKE ?)';
    params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
  }
  if (device) { where += ' AND p.device_code = ?'; params.push(device); }
  if (status) { where += ' AND p.status = ?'; params.push(status); }

  const now = planNow();
  const rows = db.prepare(`
    SELECT ${planSelectFields()}
    FROM production_plans p
    LEFT JOIN devices d ON d.device_code = p.device_code
    ${where}
    ORDER BY p.start_time DESC, p.id DESC
    LIMIT ${EXPORT_MAX_ROWS}
  `).all(...params).map((r) => decoratePlan(r, now));

  const headers = [
    '计划编号', '计划名称', '设备编号', '设备名称', '产品型号', '计划数',
    '完成数', '合格数', '完成率(%)', '状态', '下达时间', '开始执行时间',
    '暂停时间', '暂停原因', '完成时间', '结案时间', '取消时间',
    '计划开始时间', '计划结束时间', '备注',
  ];
  const body = rows.map((r) => [
    r.plan_code,
    r.plan_name,
    r.device_code,
    r.device_name || '',
    r.product_model || '',
    Number(r.plan_count) || 0,
    Number(r.actual_count) || 0,
    Number(r.qualified_count) || 0,
    r.rate_percent,
    PLAN_STATUS_TEXT[r.status] || r.status,
    r.issued_at || '',
    r.started_at || '',
    r.paused_at || '',
    r.pause_reason || '',
    r.completed_at || '',
    r.closed_at || '',
    r.cancelled_at || '',
    r.start_time,
    r.end_time,
    r.remark || '',
  ]);

  sendCsv(res, `生产计划_${startDate}_${endDate}_${exportStamp()}.csv`, headers, body);
}

// GET /api/plans/options - 计划表单可选设备（仅启用）与产品
function getPlanOptions(req, res) {
  const devices = db.prepare(`
    SELECT device_code, device_name FROM devices
    WHERE is_active = 1 AND device_code IS NOT NULL AND device_code <> ''
    ORDER BY device_code
  `).all();
  const products = db.prepare(`
    SELECT DISTINCT product_model FROM process_data
    WHERE product_model IS NOT NULL AND product_model <> ''
    ORDER BY product_model
  `).all().map(r => r.product_model);
  json(res, { devices, products });
}

// 计划操作人：优先取登录用户；仅机器令牌等无用户场景才回落到请求体
function planOperator(req, body) {
  const user = req && req.user;
  if (user && user.username) return user.username;
  return toText(body && body.operator) || '系统';
}

// POST /api/plans/create - 新增计划（一律从「起草」状态开始）
function createPlan(req, res, body) {
  const valid = validatePlan(body);
  if (valid.error) return json(res, { error: valid.error }, 400);

  const code = valid.planCode || nextPlanCode();
  if (db.prepare('SELECT id FROM production_plans WHERE plan_code = ?').get(code)) {
    return json(res, { error: `计划编号 ${code} 已存在` }, 400);
  }

  let newId = null;
  db.transaction(() => {
    const info = db.prepare(`
      INSERT INTO production_plans
        (plan_code, plan_name, device_code, product_model, plan_count, start_time, end_time, status, remark)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?)
    `).run(code, valid.planName, valid.deviceCode, valid.productModel, valid.planCount,
      valid.start, valid.end, valid.remark);
    newId = info.lastInsertRowid;
    addPlanLog(newId, code, 'create', '', 'draft', planOperator(req, body), '新建计划（起草）');
  })();

  json(res, { success: true, plan: getPlanById(newId) });
}

// POST /api/plans/update - 修改计划
//   起草：可改全部字段
//   已下达 / 执行中 / 暂停：仅可改计划名称与备注（排产要素已生效，需先撤回为起草）
//   已完成 / 已结案 / 已取消：不可编辑
function updatePlan(req, res, body) {
  const id = Number(body && body.id);
  const plan = db.prepare('SELECT * FROM production_plans WHERE id = ?').get(id);
  if (!plan) return json(res, { error: '计划不存在' }, 404);

  if (!['draft', 'issued', 'running', 'paused'].includes(plan.status)) {
    return json(res, {
      error: `计划当前为「${PLAN_STATUS_TEXT[plan.status] || plan.status}」，不可编辑`,
    }, 400);
  }

  const merged = {
    plan_code: body.plan_code !== undefined ? body.plan_code : plan.plan_code,
    plan_name: body.plan_name !== undefined ? body.plan_name : plan.plan_name,
    device_code: body.device_code !== undefined ? body.device_code : plan.device_code,
    product_model: body.product_model !== undefined ? body.product_model : plan.product_model,
    plan_count: body.plan_count !== undefined ? body.plan_count : plan.plan_count,
    start_time: body.start_time !== undefined ? body.start_time : plan.start_time,
    end_time: body.end_time !== undefined ? body.end_time : plan.end_time,
    // 状态只能通过 /api/plans/status 变更（走状态机），编辑接口忽略传入的 status
    status: plan.status,
    remark: body.remark !== undefined ? body.remark : plan.remark,
  };
  const valid = validatePlan(merged);
  if (valid.error) return json(res, { error: valid.error }, 400);

  const code = valid.planCode || plan.plan_code;
  const dup = db.prepare('SELECT id FROM production_plans WHERE plan_code = ? AND id <> ?').get(code, id);
  if (dup) return json(res, { error: `计划编号 ${code} 已存在` }, 400);

  if (plan.status !== 'draft') {
    const nextValues = {
      plan_code: code,
      device_code: valid.deviceCode,
      product_model: valid.productModel,
      plan_count: String(valid.planCount),
      start_time: valid.start,
      end_time: valid.end,
    };
    const changed = PLAN_LOCKED_FIELDS.filter(
      (key) => String(nextValues[key] ?? '') !== String(plan[key] ?? '')
    );
    if (changed.length) {
      return json(res, {
        error: '计划已下达，仅可修改计划名称与备注；如需调整排产请先「撤回」为起草',
      }, 400);
    }
  }

  db.transaction(() => {
    db.prepare(`
      UPDATE production_plans
      SET plan_code = ?, plan_name = ?, device_code = ?, product_model = ?, plan_count = ?,
          start_time = ?, end_time = ?, remark = ?, updated_at = datetime('now','localtime')
      WHERE id = ?
    `).run(code, valid.planName, valid.deviceCode, valid.productModel, valid.planCount,
      valid.start, valid.end, valid.remark, id);
    addPlanLog(id, code, 'update', plan.status, plan.status, planOperator(req, body), '修改计划信息');
  })();

  json(res, { success: true, plan: getPlanById(id) });
}

// POST /api/plans/status - 计划状态流转
//   body: { id, status, remark, operator }
//   status: issued(下达) / running(开始执行·恢复) / paused(暂停) / completed(完成)
//           / closed(结案) / cancelled(取消) / draft(撤回·恢复起草)
function updatePlanStatus(req, res, body) {
  const id = Number(body && body.id);
  const status = toText(body && body.status);
  const remark = toText(body && body.remark);
  if (!PLAN_STATUS.includes(status)) return json(res, { error: '计划状态不合法' }, 400);
  if (!Number.isSafeInteger(id) || id <= 0) return json(res, { error: '计划不存在' }, 404);

  const plan = db.prepare('SELECT * FROM production_plans WHERE id = ?').get(id);
  if (!plan) return json(res, { error: '计划不存在' }, 404);
  // 重复设置同一状态视为幂等
  if (plan.status === status) return json(res, { success: true, plan: getPlanById(id) });

  if (!(PLAN_TRANSITIONS[plan.status] || []).includes(status)) {
    return json(res, {
      error: `不允许将计划从「${PLAN_STATUS_TEXT[plan.status] || plan.status}」变更为「${PLAN_STATUS_TEXT[status] || status}」`,
    }, 400);
  }
  if (status === 'paused' && !remark) {
    return json(res, { error: '暂停计划需填写暂停原因' }, 400);
  }

  const now = planNow();

  // 实际发生时间：仅「首次开始执行」与「完成」允许手工补录（操作滞后于实际生产时使用）
  //   暂停 / 恢复 / 取消 / 下达 / 结案仍按实际切换时间，保证暂停记录真实
  let occurredAt = now;
  const firstStart = status === 'running' && !plan.started_at;
  const manualAllowed = status === 'completed' || firstStart;
  const rawOccurred = toText(body && body.occurred_at);
  if (rawOccurred && manualAllowed) {
    occurredAt = normalizePlanTime(rawOccurred);
    if (!occurredAt) return json(res, { error: '时间格式应为 YYYY-MM-DD HH:MM，且必须是有效日期' }, 400);
    if (occurredAt > now) return json(res, { error: '填报时间不能晚于当前时间' }, 400);
  }

  // 填报时间必须落在计划周期内：早于计划开始 / 晚于计划结束会造成
  // 「设备被长期占用但完成数为 0」的口径错位
  if ((status === 'running' || status === 'completed') && occurredAt < plan.start_time) {
    return json(res, {
      error: `填报时间不能早于计划开始时间（${plan.start_time}）`,
    }, 400);
  }
  if (status === 'running' && plan.end_time && occurredAt > plan.end_time) {
    return json(res, {
      error: `计划周期已于 ${plan.end_time} 结束，请先撤回为起草并调整计划周期后再执行`,
    }, 400);
  }

  // 同一设备同一时间段只允许一个计划执行：开始 / 恢复执行前校验执行区间是否与其它计划重叠
  if (status === 'running') {
    const newEnd = plan.end_time && plan.end_time > occurredAt ? plan.end_time : occurredAt;
    const conflict = findPlanConflict(plan.device_code, id, occurredAt, newEnd);
    if (conflict) {
      const range = conflict.ended_at
        ? `${conflict.started_at} ~ ${conflict.ended_at}`
        : `${conflict.started_at} ~ 至今`;
      return json(res, {
        error: `设备 ${plan.device_code} 在该时段已被计划【${conflict.plan_code}${conflict.plan_name ? ' ' + conflict.plan_name : ''}】占用（${range}），同一设备同一时间只能执行一个计划；请先完成或暂停该计划`,
      }, 400);
    }
  }

  if (status === 'completed') {
    const opened = db.prepare(`
      SELECT started_at FROM production_plan_segments
      WHERE plan_id = ? AND ended_at IS NULL
      ORDER BY id DESC LIMIT 1
    `).get(id);
    if (opened && occurredAt < opened.started_at) {
      return json(res, {
        error: `完成时间不能早于本次执行开始时间（${opened.started_at}）`,
      }, 400);
    }
  }

  const sets = ['status = ?', "updated_at = datetime('now','localtime')"];
  const params = [status];

  if (status === 'issued') {
    sets.push('issued_at = ?', 'cancelled_at = NULL');
    params.push(now);
  }
  if (status === 'running') {
    // 首次开始执行按填报时间，恢复执行保留首次时间
    sets.push('started_at = COALESCE(started_at, ?)', 'paused_at = NULL');
    params.push(occurredAt);
  }
  if (status === 'paused') {
    sets.push('paused_at = ?', 'pause_reason = ?');
    params.push(now, remark);
  }
  if (status === 'completed') {
    sets.push('completed_at = ?', 'pause_reason = NULL');
    params.push(occurredAt);
  }
  if (status === 'closed') {
    sets.push('closed_at = ?');
    params.push(now);
  }
  if (status === 'cancelled') {
    sets.push('cancelled_at = ?');
    params.push(now);
  }
  if (status === 'draft') {
    // 撤回 / 恢复起草：清空流程时间戳，重新走一遍流程
    sets.push('issued_at = NULL', 'started_at = NULL', 'paused_at = NULL',
      'pause_reason = NULL', 'completed_at = NULL', 'closed_at = NULL', 'cancelled_at = NULL');
  }

  const operator = planOperator(req, body);
  const commit = db.transaction(() => {
    db.prepare(`UPDATE production_plans SET ${sets.join(', ')} WHERE id = ?`).run(...params, id);

    // 维护执行段：
    //   执行中 → 开启一段（首次开始 / 暂停后恢复）
    //   暂停 / 完成 / 取消 → 关闭当前段，暂停期间的产出不计入本计划
    //   撤回 / 恢复起草 → 清空所有段，重新走流程
    if (status === 'running') openPlanSegment(id, occurredAt);
    if (['paused', 'completed', 'cancelled'].includes(status)) closePlanSegment(id, occurredAt);
    if (status === 'draft') clearPlanSegments(id);

    addPlanLog(id, plan.plan_code, status, plan.status, status, operator,
      remark || PLAN_ACTION_TEXT[status] || status);
  });
  commit();

  json(res, { success: true, plan: getPlanById(id) });
}

// POST /api/plans/delete - 删除计划（仅起草 / 已取消可删除）
function deletePlan(req, res, body) {
  const id = Number(body && body.id);
  const plan = db.prepare('SELECT * FROM production_plans WHERE id = ?').get(id);
  if (!plan) return json(res, { error: '计划不存在' }, 404);
  if (!['draft', 'cancelled'].includes(plan.status)) {
    return json(res, {
      error: `计划当前为「${PLAN_STATUS_TEXT[plan.status] || plan.status}」，不可删除；如需终止请先取消计划`,
    }, 400);
  }

  addPlanLog(id, plan.plan_code, 'delete', plan.status, '', planOperator(req, body), '删除计划');
  const remove = db.transaction(() => {
    // 计划删除后执行段一起清理；流转日志保留用于追溯
    clearPlanSegments(id);
    db.prepare('DELETE FROM production_plans WHERE id = ?').run(id);
  });
  remove();
  json(res, { success: true });
}

// GET /api/plans/logs - 计划状态流转记录（?id= 过滤单条计划，?limit= 限制条数）
function getPlanLogs(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const id = Number(url.searchParams.get('id'));
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 100, 1), 500);
  const rows = id
    ? db.prepare(`
        SELECT * FROM production_plan_logs
        WHERE plan_id = ?
        ORDER BY operate_time DESC, id DESC
        LIMIT ?
      `).all(id, limit)
    : db.prepare(`
        SELECT * FROM production_plan_logs
        ORDER BY operate_time DESC, id DESC
        LIMIT ?
      `).all(limit);
  json(res, rows);
}

// GET /api/plans/records - 计划关联的工艺数据（口径与完成数一致）
//   设备 + 计划周期 ∩ 执行段 + 可选产品 + 设备启用
function getPlanRecords(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const id = Number(url.searchParams.get('id'));
  const page = Math.min(PAGE_MAX, Math.max(1, Number(url.searchParams.get('page')) || 1));
  const pageSize = Math.min(Math.max(Number(url.searchParams.get('pageSize')) || 20, 1), 100);

  const plan = db.prepare('SELECT * FROM production_plans WHERE id = ?').get(id);
  if (!plan) return json(res, { error: '计划不存在' }, 404);

  const where = [];
  const params = [];

  where.push('x.device_code = ?');
  params.push(plan.device_code);
  where.push('x.collect_time >= ?', 'x.collect_time <= ?');
  params.push(plan.start_time, plan.end_time);
  if (plan.product_model) {
    where.push('x.product_model = ?');
    params.push(plan.product_model);
  }
  where.push(`EXISTS (SELECT 1 FROM production_plan_segments s
      WHERE s.plan_id = ?
        AND x.collect_time >= s.started_at
        AND x.collect_time <= COALESCE(s.ended_at, datetime('now','localtime')))`);
  params.push(plan.id);
  where.push('EXISTS (SELECT 1 FROM devices dv WHERE dv.device_code = x.device_code AND dv.is_active = 1)');

  const whereSql = where.join(' AND ');
  const total = db.prepare(`SELECT COUNT(*) AS c FROM process_data x WHERE ${whereSql}`)
    .get(...params).c;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);

  const rows = db.prepare(`
    SELECT x.* FROM process_data x
    WHERE ${whereSql}
    ORDER BY x.collect_time DESC, x.id DESC
    LIMIT ? OFFSET ?
  `).all(...params, pageSize, (safePage - 1) * pageSize);

  // total 与该计划的完成数同口径，直接回填给弹窗展示
  const planView = decoratePlan(plan, planNow());
  planView.actual_count = total;
  planView.rate = planView.plan_count > 0 ? Math.min(total / planView.plan_count, 1) : 0;
  planView.rate_percent = planView.plan_count > 0
    ? Number(((total / planView.plan_count) * 100).toFixed(1))
    : 0;

  json(res, {
    total,
    page: safePage,
    pageSize,
    totalPages,
    data: rows,
    params: processParamList(),
    plan: planView,
  });
}

// ==================== 启动时数据库结构升级 ====================
// 兼容旧库：统一设备编号、补齐 workpiece_no、迁移旧工件分析表数据、迁移旧版无版本的标准表

// 旧库设备编号（DEV-xxx）与工艺采集编号（YZJ-001 等）口径不一致，按设备名称统一
const DEVICE_CODE_MAP = {
  '红外钳机': 'HWQJ-008',
  '压铸机': 'YZJ-001',
  '真空机': 'ZKJ-002',
  '喷雾机': 'PWJ-003',
  '抽芯机': 'CXJ-004',
  '求温机': 'QWJ-006',
  '取件机': 'QJJ-005',
  '点冷机': 'DLJ-007',
};

function ensureDeviceCodes() {
  if (!tableExists('devices')) return;
  const devices = db.prepare('SELECT id, device_name, device_code FROM devices').all();
  devices.forEach((d) => {
    const target = DEVICE_CODE_MAP[d.device_name];
    if (!target || d.device_code === target) return;
    const taken = db.prepare('SELECT id FROM devices WHERE device_code = ? AND id <> ?').get(target, d.id);
    if (taken) return;
    db.prepare("UPDATE devices SET device_code = ?, updated_at = datetime('now','localtime') WHERE id = ?").run(target, d.id);
    if (d.device_code) {
      // 与接口改名保持一致：工艺数据 / 生产计划 / 生产统计同时迁移，避免计划悬空
      if (tableExists('process_data')) {
        db.prepare('UPDATE process_data SET device_code = ? WHERE device_code = ?').run(target, d.device_code);
      }
      if (tableExists('production_plans')) {
        db.prepare('UPDATE production_plans SET device_code = ? WHERE device_code = ?').run(target, d.device_code);
      }
      if (tableExists('production_stats')) {
        db.prepare('UPDATE production_stats SET device_code = ? WHERE device_code = ?').run(target, d.device_code);
      }
    }
    logWrite('MIGRATE', `设备编号统一：${d.device_name} ${d.device_code || '(空)'} → ${target}`);
  });

  // 工艺数据中出现但设备表未登记的编号，自动登记，保证各页面设备口径一致
  if (tableExists('process_data')) {
    const orphans = db.prepare(`
      SELECT DISTINCT p.device_code AS code
      FROM process_data p
      WHERE p.device_code IS NOT NULL AND p.device_code <> ''
        AND NOT EXISTS (SELECT 1 FROM devices d WHERE d.device_code = p.device_code)
    `).all();
    const insDevice = db.prepare(`
      INSERT INTO devices (device_name, device_type, device_code, location, description, is_active)
      VALUES (?, '采集设备', ?, '压铸车间', '由工艺数据自动登记', 1)
    `);
    const insStatus = db.prepare(`
      INSERT INTO device_status (device_id, status, alarm_info, detail_info)
      VALUES (?, 'running', '正常运行', '设备已自动登记')
    `);
    orphans.forEach((o) => {
      const info = insDevice.run(o.code, o.code);
      insStatus.run(info.lastInsertRowid);
      logWrite('MIGRATE', `自动登记设备：${o.code}`);
    });
  }
}

// 生产计划模块表结构（老库启动时自动补齐，无需重跑 init_all.sql）
function ensurePlanSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS production_plans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      plan_code TEXT NOT NULL UNIQUE,
      plan_name TEXT,
      device_code TEXT NOT NULL,
      product_model TEXT,
      plan_count INTEGER NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      issued_at TEXT,
      started_at TEXT,
      paused_at TEXT,
      pause_reason TEXT,
      completed_at TEXT,
      closed_at TEXT,
      cancelled_at TEXT,
      remark TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      updated_at TEXT DEFAULT (datetime('now','localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_plan_device ON production_plans(device_code);
    CREATE INDEX IF NOT EXISTS idx_plan_time ON production_plans(start_time, end_time);
    CREATE INDEX IF NOT EXISTS idx_plan_status ON production_plans(status);

    CREATE TABLE IF NOT EXISTS production_plan_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      plan_id INTEGER NOT NULL,
      plan_code TEXT,
      action TEXT NOT NULL,
      from_status TEXT,
      to_status TEXT,
      operator TEXT,
      remark TEXT,
      operate_time TEXT DEFAULT (datetime('now','localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_plan_log_plan ON production_plan_logs(plan_id, operate_time DESC);

    CREATE TABLE IF NOT EXISTS production_plan_segments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      plan_id INTEGER NOT NULL,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_plan_seg_plan ON production_plan_segments(plan_id, started_at);
    -- 冲突检测按开始时间过滤（join 设备后无法用 plan_id 前缀），单独建时间索引
    CREATE INDEX IF NOT EXISTS idx_plan_seg_time ON production_plan_segments(started_at);
  `);

  // 老库补列：状态流转相关时间戳（新增字段无需重跑 init_all.sql）
  const cols = tableColumns('production_plans');
  [
    ['issued_at', 'TEXT'],
    ['started_at', 'TEXT'],
    ['paused_at', 'TEXT'],
    ['pause_reason', 'TEXT'],
    ['closed_at', 'TEXT'],
    ['cancelled_at', 'TEXT'],
  ].forEach(([name, type]) => {
    if (cols.includes(name)) return;
    db.exec(`ALTER TABLE production_plans ADD COLUMN ${name} ${type}`);
  });

  // 老库升级：为已有计划补建执行段，保证历史完成数与改造前一致
  try {
    const segCount = db.prepare('SELECT COUNT(1) AS c FROM production_plan_segments WHERE plan_id = ?');
    const insertSeg = db.prepare(
      'INSERT INTO production_plan_segments (plan_id, started_at, ended_at) VALUES (?, ?, ?)'
    );
    const plans = db.prepare(`
      SELECT id, status, issued_at, started_at, start_time, end_time,
             paused_at, completed_at, closed_at, cancelled_at, created_at
      FROM production_plans
    `).all();

    const migrate = db.transaction(() => {
      plans.forEach((p) => {
        if (segCount.get(p.id).c > 0) return;
        if (!['running', 'paused', 'completed', 'closed', 'cancelled'].includes(p.status)) return;
        // 执行中 / 暂停：从实际开始执行时间起算；已完成 / 结案 / 取消：沿用原统计口径（整个计划周期）
        const start = ['running', 'paused'].includes(p.status)
          ? (p.started_at || p.issued_at || p.start_time || p.created_at)
          : (p.start_time || p.started_at || p.created_at);
        let end = null;
        if (p.status === 'paused') {
          end = p.paused_at || planNow();
        } else if (p.status !== 'running') {
          end = p.end_time || p.completed_at || p.closed_at || p.cancelled_at || planNow();
        }
        insertSeg.run(p.id, start, end);
      });
    });
    migrate();
  } catch (e) {
    logWrite('ERROR', `补建计划执行段失败: ${e && e.message ? e.message : e}`);
  }
}

// 名称唯一性最终应由数据库唯一索引保证（避免「先查再插」的并发窗口）。
// 老库可能存在重复数据，检测到重复时跳过创建并告警，避免服务启动失败。
function ensureUniqueIndexSafely(tableName, columnName, indexName) {
  if (!tableExists(tableName)) return;
  try {
    const dup = db.prepare(`
      SELECT ${columnName} AS v FROM ${tableName}
      WHERE ${columnName} IS NOT NULL AND ${columnName} <> ''
      GROUP BY ${columnName} HAVING COUNT(*) > 1 LIMIT 1
    `).get();
    if (dup !== undefined) {
      logWrite('WARN', `${tableName}.${columnName} 存在重复值「${dup.v}」，已跳过唯一索引 ${indexName}，请人工清理后重启`);
      return;
    }
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS ${indexName} ON ${tableName}(${columnName})`);
  } catch (err) {
    logWrite('WARN', `创建唯一索引 ${indexName} 失败: ${err && err.message}`);
  }
}

// 产品基础表（老库缺失时自动补齐，热成像记录通过 product_id 关联本表）
function ensureProductSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_name TEXT NOT NULL,
      product_code TEXT UNIQUE,
      product_type TEXT,
      description TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      updated_at TEXT DEFAULT (datetime('now','localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_products_type ON products(product_type);
  `);
}

// 模具档案 / 模具配方表结构（老库自动补齐）
// mold_recipes.product_id 引用 products，product_name 作为冗余快照保留，
// 老库中的历史文本名称会按名称匹配自动回填 product_id。
function ensureRecipeSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS molds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mold_name TEXT NOT NULL,
      mold_code TEXT UNIQUE,
      mold_type TEXT,
      description TEXT,
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      updated_at TEXT DEFAULT (datetime('now','localtime'))
    );
    CREATE TABLE IF NOT EXISTS mold_recipes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER,
      product_name TEXT NOT NULL,
      mold_id INTEGER,
      production_line TEXT,
      fast1_enabled TEXT DEFAULT '否',
      fast1_position REAL DEFAULT 0,
      fast1_valve REAL DEFAULT 0,
      fast2_enabled TEXT DEFAULT '否',
      fast2_position REAL DEFAULT 0,
      fast2_valve REAL DEFAULT 0,
      boost_enabled TEXT DEFAULT '0',
      boost_position REAL DEFAULT 0,
      boost_pressure REAL DEFAULT 0,
      track_end_pos REAL DEFAULT 0,
      fast_energy_pressure REAL DEFAULT 0,
      boost_energy_pressure REAL DEFAULT 0,
      injection_time REAL DEFAULT 0,
      boost_delay REAL DEFAULT 0,
      cooling_time REAL DEFAULT 0,
      hammer_delay REAL DEFAULT 0,
      slow_flow REAL DEFAULT 0,
      remark TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      updated_at TEXT DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL,
      FOREIGN KEY (mold_id) REFERENCES molds(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_recipe_product ON mold_recipes(product_name);
    CREATE INDEX IF NOT EXISTS idx_recipe_mold ON mold_recipes(mold_id);
    CREATE INDEX IF NOT EXISTS idx_recipe_line ON mold_recipes(production_line);
  `);

  // 老库（product_id 列尚未建立）补列
  if (!tableColumns('mold_recipes').includes('product_id')) {
    db.exec('ALTER TABLE mold_recipes ADD COLUMN product_id INTEGER');
    logWrite('MIGRATE', 'mold_recipes 补充 product_id 列（关联 products 产品档案）');
  }

  // 历史文本产品名 → 产品档案 id 回填
  const pending = db.prepare(`
    SELECT id, product_name FROM mold_recipes
    WHERE product_id IS NULL AND product_name IS NOT NULL AND product_name <> ''
  `).all();
  if (pending.length) {
    const findProduct = db.prepare('SELECT id FROM products WHERE product_name = ?');
    const bindProduct = db.prepare('UPDATE mold_recipes SET product_id = ? WHERE id = ?');
    let matched = 0;
    db.transaction(() => {
      pending.forEach((row) => {
        const product = findProduct.get(String(row.product_name).trim());
        if (!product) return;
        bindProduct.run(product.id, row.id);
        matched += 1;
      });
    })();
    logWrite('MIGRATE', `配方产品关联回填：${matched}/${pending.length} 条按产品名称匹配到产品档案`);
  }

  // 历史数据修复：早期初始化脚本把 mold_id 硬编码为 1..n，molds 重新灌数后可能悬空。
  // 不能按「id 升序」猜测重映射（会把配方错误绑定到别的模具），统一置空并提示人工确认。
  const cleared = db.prepare(`
    UPDATE mold_recipes
    SET mold_id = NULL, updated_at = datetime('now','localtime')
    WHERE mold_id IS NOT NULL AND mold_id > 0
      AND NOT EXISTS (SELECT 1 FROM molds m WHERE m.id = mold_recipes.mold_id)
  `).run().changes;
  if (cleared) {
    logWrite('MIGRATE', `配方模具关联修复：${cleared} 条悬空 mold_id 已置空，请在「模具配方」中重新选择模具`);
  }

  db.exec('CREATE INDEX IF NOT EXISTS idx_recipe_product_id ON mold_recipes(product_id)');
  ensureUniqueIndexSafely('molds', 'mold_name', 'uq_molds_name');
}

// 清理历史遗留表：process_standards 已被分析标准版本表
// (analysis_standard_versions + analysis_standards) 取代，代码中已无任何读写，
// 启动时一次性删除，避免继续占用存储并造成"标准来源"歧义。
function dropLegacyTables() {
  if (!tableExists('process_standards')) return;
  let removed = 0;
  try {
    removed = db.prepare('SELECT COUNT(*) AS cnt FROM process_standards').get().cnt;
  } catch {
    removed = 0;
  }
  db.exec('DROP TABLE IF EXISTS process_standards');
  logWrite('MIGRATE', `已删除未使用表 process_standards（原 ${removed} 条记录，工艺标准统一由 analysis_standards 维护）`);
}

// 用户与会话表：登录账号、页面授权（JSON 数组）、按钮动作授权
function ensureUserSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      display_name TEXT NOT NULL DEFAULT '',
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'normal',
      display_pages TEXT NOT NULL DEFAULT '[]',
      admin_pages TEXT NOT NULL DEFAULT '[]',
      actions TEXT NOT NULL DEFAULT '[]',
      is_active INTEGER NOT NULL DEFAULT 1,
      last_login_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE TABLE IF NOT EXISTS user_sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      last_seen TEXT,
      ip TEXT DEFAULT '',
      user_agent TEXT DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON user_sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_user_sessions_exp ON user_sessions(expires_at);
  `);

  const count = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  if (!count) {
    // 未显式配置时使用一次性随机密码，杜绝 admin/123456 这类默认弱口令
    const configuredOk = CONFIGURED_ADMIN_PASSWORD && isValidPasswordLength(CONFIGURED_ADMIN_PASSWORD);
    if (CONFIGURED_ADMIN_PASSWORD && !configuredOk) {
      logWrite('ERROR', `DEFAULT_ADMIN_PASSWORD 长度需在 ${PASSWORD_MIN_LENGTH} ~ ${PASSWORD_MAX_LENGTH} 位之间，已改用随机密码`);
    }
    const initialPassword = configuredOk
      ? CONFIGURED_ADMIN_PASSWORD
      : crypto.randomBytes(12).toString('base64url');
    db.prepare(`
      INSERT INTO users (username, display_name, password_hash, role, display_pages, admin_pages, actions)
      VALUES (?, ?, ?, 'super', ?, ?, '[]')
    `).run(
      DEFAULT_ADMIN_USER,
      '超级管理员',
      hashPasswordSync(initialPassword),
      JSON.stringify(DISPLAY_PAGE_KEYS),
      JSON.stringify(ADMIN_PAGE_KEYS)
    );
    if (configuredOk) {
      logWrite('SYSTEM', `已创建初始超级管理员 ${DEFAULT_ADMIN_USER}（密码取自 DEFAULT_ADMIN_PASSWORD），请登录后修改密码`);
    } else {
      // 随机密码只在此处输出一次，不写入日志文件
      console.log(`[INIT] 初始超级管理员账号：${DEFAULT_ADMIN_USER}`);
      console.log(`[INIT] 随机初始密码（仅显示一次，请立即登录后修改）：${initialPassword}`);
      logWrite('SYSTEM', `已创建初始超级管理员 ${DEFAULT_ADMIN_USER}（随机密码，仅控制台输出一次）`);
    }
  }
}

function ensureSchema() {
  ensureUserSchema();
  ensureDeviceCodes();
  ensurePlanSchema();
  ensureProductSchema();
  ensureRecipeSchema();
  dropLegacyTables();
  if (!tableExists('process_data')) return;

  const colNames = tableColumns('process_data');
  if (!colNames.includes('workpiece_no')) {
    db.exec('ALTER TABLE process_data ADD COLUMN workpiece_no TEXT');
  }

  // 工艺参数扩展字段：老库启动时自动补列（新增参数无需手工改库）
  const extraParamColumns = [
    ['injection_time', 'REAL'],    // 压射时间(s)
    ['sprue_thickness', 'REAL'],   // 料柄厚度(mm)
    ['furnace_temp', 'REAL'],      // 熔炉当前温度(℃)
    ['goose_neck_temp', 'REAL'],   // 鹅颈当前温度(℃)
    ['nozzle_temp', 'REAL'],       // 射嘴当前温度(℃)
    ['oil_temp', 'REAL'],          // 当前油温(℃)
    ['fast_switch_point', 'REAL'], // 高速切换点(mm)
  ];
  let addedParams = 0;
  extraParamColumns.forEach(([name, type]) => {
    if (colNames.includes(name)) return;
    db.exec(`ALTER TABLE process_data ADD COLUMN ${name} ${type}`);
    addedParams += 1;
  });
  if (addedParams) {
    logWrite('MIGRATE', `process_data 已补充 ${addedParams} 个工艺参数字段`);
  }

  // 旧版 analysis_standards（无 version_id）先落地为临时数据，稍后迁移到默认版本
  let legacyStandards = null;
  const stdCols = tableColumns('analysis_standards');
  if (stdCols.length && !stdCols.includes('version_id')) {
    legacyStandards = db.prepare('SELECT * FROM analysis_standards').all();
    db.exec('DROP TABLE analysis_standards');
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS analysis_standard_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      version_code TEXT NOT NULL UNIQUE,
      version_name TEXT NOT NULL,
      product_model TEXT,
      effective_from TEXT NOT NULL,
      effective_to TEXT,
      remark TEXT,
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      updated_at TEXT DEFAULT (datetime('now','localtime'))
    );
    CREATE TABLE IF NOT EXISTS analysis_standards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      version_id INTEGER NOT NULL,
      param_name TEXT NOT NULL,
      param_key TEXT NOT NULL,
      standard_value REAL NOT NULL,
      tolerance REAL NOT NULL,
      unit TEXT,
      display_order INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      updated_at TEXT DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (version_id) REFERENCES analysis_standard_versions(id) ON DELETE CASCADE,
      UNIQUE (version_id, param_key)
    );
    CREATE TABLE IF NOT EXISTS analysis_standard_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      version_id INTEGER,
      version_code TEXT,
      action TEXT NOT NULL,
      target TEXT,
      content TEXT,
      operator TEXT DEFAULT '系统',
      operate_time TEXT DEFAULT (datetime('now','localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_std_version_effective ON analysis_standard_versions(effective_from, effective_to);
    CREATE INDEX IF NOT EXISTS idx_std_version_id ON analysis_standards(version_id);
    CREATE INDEX IF NOT EXISTS idx_std_log_time ON analysis_standard_logs(operate_time);
  `);

  // 生产统计模块表结构（老库自动补齐）
  db.exec(`
    CREATE TABLE IF NOT EXISTS shift_config (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      shift_code TEXT NOT NULL UNIQUE,
      shift_name TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      sort_order INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      updated_at TEXT DEFAULT (datetime('now','localtime'))
    );
    CREATE TABLE IF NOT EXISTS production_stats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      stat_date TEXT NOT NULL,
      shift_code TEXT NOT NULL DEFAULT '',
      shift_name TEXT DEFAULT '全天',
      device_code TEXT NOT NULL,
      total_count INTEGER DEFAULT 0,
      qualified_count INTEGER DEFAULT 0,
      warning_count INTEGER DEFAULT 0,
      unqualified_count INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      updated_at TEXT DEFAULT (datetime('now','localtime')),
      UNIQUE (stat_date, shift_code, device_code)
    );
    CREATE INDEX IF NOT EXISTS idx_stats_date ON production_stats(stat_date);
    CREATE INDEX IF NOT EXISTS idx_stats_shift ON production_stats(shift_code);
    CREATE INDEX IF NOT EXISTS idx_stats_device ON production_stats(device_code);
  `);

  // 迁移旧标准明细到默认版本（生效起点设为很早，保证历史数据都有标准可判定）
  if (legacyStandards && legacyStandards.length) {
    let version = db.prepare('SELECT * FROM analysis_standard_versions WHERE version_code = ?').get('STD-LEGACY');
    if (!version) {
      const info = db.prepare(`
        INSERT INTO analysis_standard_versions (version_code, version_name, effective_from, remark)
        VALUES ('STD-LEGACY', '历史标准', '2000-01-01 00:00:00', '由旧版分析标准自动迁移')
      `).run();
      version = { id: info.lastInsertRowid, version_code: 'STD-LEGACY' };
    }
    const ins = db.prepare(`
      INSERT OR IGNORE INTO analysis_standards
        (version_id, param_name, param_key, standard_value, tolerance, unit, display_order)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    legacyStandards.forEach((s, i) => {
      ins.run(version.id, s.param_name, s.param_key, s.standard_value, s.tolerance, s.unit || '', s.display_order || i + 1);
    });
  }

  // 迁移旧工件分析表数据到工艺数据表，随后删除旧表
  if (tableExists('workpiece_analysis')) {
    const rows = db.prepare('SELECT * FROM workpiece_analysis').all();
    const sameRecord = db.prepare(
      'SELECT id FROM process_data WHERE collect_time = ? AND device_code = ? AND product_model = ?'
    );
    const sameWorkpiece = db.prepare('SELECT id FROM process_data WHERE workpiece_no = ?');
    const ins = db.prepare(`
      INSERT INTO process_data
        (collect_time, device_code, product_model, batch_no, workpiece_no,
         slow_speed, fast_speed, cast_pressure, boost_pressure,
         pour_temp, mold_temp, cycle_time, hold_time, data_status, remark)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    let migrated = 0;
    const tx = db.transaction(() => {
      rows.forEach((r) => {
        // 工艺数据表中已存在同一采集记录时，直接沿用工艺数据，避免重复
        if (sameRecord.get(r.collect_time, r.device_code, r.product_model)) return;
        if (r.workpiece_no && sameWorkpiece.get(r.workpiece_no)) return;
        const status = r.judge_result === 'unqualified' ? 'unqualified'
          : r.judge_result === 'warning' ? 'warning' : 'normal';
        ins.run(r.collect_time, r.device_code, r.product_model, r.batch_no || '', r.workpiece_no,
          r.slow_speed, r.fast_speed, r.cast_pressure, r.boost_pressure,
          r.pour_temp, r.mold_temp, r.cycle_time, r.hold_time, status, '由旧工件分析表迁移');
        migrated += 1;
      });
    });
    tx();
    db.exec('DROP TABLE IF EXISTS workpiece_analysis');
    logWrite('MIGRATE', `旧工件分析表处理完成：补充 ${migrated} 条缺失记录，已删除 workpiece_analysis 表`);
  }

  // 补齐工艺记录的工件编号（分析模块以此标识记录），逐个生成并规避重复
  const missingNo = db.prepare(`
    SELECT id, collect_time FROM process_data WHERE workpiece_no IS NULL OR workpiece_no = ''
  `).all();
  if (missingNo.length) {
    const takenNo = db.prepare('SELECT id FROM process_data WHERE workpiece_no = ?');
    const updateNo = db.prepare('UPDATE process_data SET workpiece_no = ? WHERE id = ?');
    db.transaction(() => {
      missingNo.forEach((r) => {
        const base = `WJ${String(r.collect_time || '').slice(0, 10).replace(/-/g, '')}${String(r.id).padStart(4, '0')}`;
        let code = base;
        let i = 1;
        while (takenNo.get(code)) code = `${base}-${i++}`;
        updateNo.run(code, r.id);
      });
    })();
  }
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_process_workpiece_no ON process_data(workpiece_no)');

  // 兼容旧数据中的状态写法（abnormal 统一为 unqualified，与筛选/判定口径一致）
  db.prepare("UPDATE process_data SET data_status = 'unqualified' WHERE data_status = 'abnormal'").run();

  // 若库中完全没有标准版本，补一个通用默认版本，避免判定结果为空
  const versionCount = db.prepare('SELECT COUNT(*) AS cnt FROM analysis_standard_versions').get().cnt;
  if (versionCount === 0) {
    const info = db.prepare(`
      INSERT INTO analysis_standard_versions (version_code, version_name, effective_from, remark)
      VALUES ('STD-DEFAULT', '默认标准', '2000-01-01 00:00:00', '系统初始化默认标准')
    `).run();
    const defaults = {
      slow_speed: [0.18, 0.03, 'm/s'], fast_speed: [2.85, 0.15, 'm/s'],
      cast_pressure: [85.0, 3.0, 'MPa'], boost_pressure: [92.0, 4.0, 'MPa'],
      pour_temp: [680, 15, '℃'], mold_temp: [245, 10, '℃'],
      cycle_time: [58.0, 3.0, 's'], hold_time: [12.5, 1.0, 's'],
    };
    const ins = db.prepare(`
      INSERT INTO analysis_standards
        (version_id, param_name, param_key, standard_value, tolerance, unit, display_order)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    let order = 0;
    processParamColumns().forEach((key) => {
      const meta = PROCESS_PARAM_META[key];
      const def = defaults[key];
      if (!def) return;
      order += 1;
      ins.run(info.lastInsertRowid, meta.name, key, def[0], def[1], def[2], order);
    });
    logWrite('MIGRATE', '数据库缺少分析标准版本，已生成默认标准');
  }
}

ensureSchema();

// 复合索引补齐（老库升级后同样生效，减少聚合与计划进度查询的回表扫描）
// 新库尚未执行 init_all.sql 时相关表不存在，按表存在性跳过，避免启动告警
function ensureIndexes() {
  const statements = [
    ['process_data', 'CREATE INDEX IF NOT EXISTS idx_process_device_time ON process_data (device_code, collect_time DESC)'],
    ['process_data', 'CREATE INDEX IF NOT EXISTS idx_process_time_status ON process_data (collect_time, data_status)'],
    ['production_stats', 'CREATE INDEX IF NOT EXISTS idx_stats_date_device ON production_stats (stat_date, device_code)'],
    ['production_plans', 'CREATE INDEX IF NOT EXISTS idx_plans_start_device ON production_plans (start_time, device_code)'],
  ];
  try {
    const tx = db.transaction(() => {
      for (const [table, sql] of statements) {
        if (tableExists(table)) db.exec(sql);
      }
    });
    tx();
  } catch (err) {
    logWrite('WARN', `索引补齐失败: ${err && err.message}`);
  }
}

ensureIndexes();

// WAL 定期合并回主库，避免 -wal 文件长期增长占满磁盘
function checkpointWal() {
  try {
    db.pragma('wal_checkpoint(TRUNCATE)');
  } catch (err) {
    logWrite('WARN', `WAL checkpoint 失败: ${err && err.message}`);
  }
}

checkpointWal();
setInterval(checkpointWal, 60 * 60 * 1000).unref();

// 清理过期登录会话（每小时 + 启动时）
function pruneSessions() {
  try {
    if (!tableExists('user_sessions')) return;
    const changes = db.prepare('DELETE FROM user_sessions WHERE expires_at <= ?').run(stampNow()).changes;
    if (changes) logWrite('CLEANUP', `清理过期登录会话 ${changes} 条`);
  } catch (err) {
    logWrite('WARN', `会话清理失败: ${err && err.message}`);
  }
}

pruneSessions();
setInterval(pruneSessions, 60 * 60 * 1000).unref();

// 历史数据保留（可选）：HISTORY_RETENTION_DAYS > 0 时清理日志 / 呼叫 / 统计派生表
//   只清理纯日志与可再生成的派生数据，不影响工艺数据、设备档案、配方与计划主表
function pruneHistory() {
  if (!HISTORY_RETENTION_DAYS) return;
  const cutoffDate = addDays(formatDateStr(new Date()), -HISTORY_RETENTION_DAYS);
  if (!cutoffDate) return;
  const cutoffTime = `${cutoffDate} 00:00:00`;
  // 注意：analysis_standard_logs 同时承载用户/权限/标准变更审计，属不可篡改留痕，
  // 不纳入自动清理；如需归档请走人工审批的导出流程。
  const jobs = [
    ['production_plan_logs', 'operate_time', cutoffTime],
    ['andon_call_logs', 'operate_time', cutoffTime],
    ['andon_calls', 'call_time', cutoffTime],
    ['device_status_history', 'start_time', cutoffTime],
    ['production_stats', 'stat_date', cutoffDate],
  ];
  try {
    const tx = db.transaction(() => {
      for (const [table, column, cutoff] of jobs) {
        if (!tableExists(table)) continue;
        const changes = db.prepare(`DELETE FROM ${table} WHERE ${column} < ?`).run(cutoff).changes;
        if (changes) logWrite('CLEANUP', `清理 ${table} 中早于 ${cutoff} 的 ${changes} 条历史数据`);
      }
    });
    tx();
  } catch (err) {
    logWrite('WARN', `历史数据清理失败: ${err && err.message}`);
  }
}

pruneHistory();
setInterval(pruneHistory, 24 * 60 * 60 * 1000).unref();

// 兜底：未捕获异常只记录、不退出进程，避免单个请求异常导致服务整体中断
process.on('uncaughtException', (err) => {
  logWrite('ERROR', `未捕获异常: ${err && err.stack ? err.stack : err}`);
});
process.on('unhandledRejection', (err) => {
  logWrite('ERROR', `未处理的 Promise 拒绝: ${err && err.stack ? err.stack : err}`);
});

server.listen(PORT, () => {
  console.log(`✅ MES Monitor API 服务已启动: http://localhost:${PORT}`);
  console.log(`📊 数据库: ${DB_PATH}`);
});
