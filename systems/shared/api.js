// API 请求工具
// 会话失效（401）回调：由 auth.js 注册，用于清理前端登录态
let unauthorizedHandler = null;

export function setUnauthorizedHandler(fn) {
  unauthorizedHandler = typeof fn === 'function' ? fn : null;
}

function withCredentials(options = {}) {
  // 同源请求默认携带 Cookie；显式声明避免被后续改动误伤
  return { credentials: 'same-origin', ...options };
}

async function parseResponse(res) {
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (res.status === 401 && unauthorizedHandler) unauthorizedHandler();
  if (!res.ok) {
    const msg = (data && data.error) || `HTTP ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  return data;
}

export async function apiGet(url) {
  const res = await fetch(url, withCredentials());
  return parseResponse(res);
}

// 注意：浏览器端不再支持也不保存 X-Admin-Token。
// 机器令牌等同超级管理员，一旦写入 localStorage 会被 XSS 或共享终端窃取，
// 仅允许 stats_job.js 等服务端脚本通过环境变量携带。
export async function apiPost(url, body) {
  const res = await fetch(url, withCredentials({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  }));
  return parseResponse(res);
}

// HTML 转义：拼接进 v-html / 属性前必须转义数据库里的文本，防止存储型 XSS
export function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// 生成分页页码数组（最多 maxButtons 个按钮，含省略号标记）
export function buildPageList(totalPages, currentPage, maxButtons = 5) {
  if (totalPages <= maxButtons) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }
  const pages = new Set([1, totalPages]);
  const half = Math.floor(maxButtons / 2);
  let start = currentPage - half;
  let end = currentPage + half;
  if (start < 2) { start = 2; end = start + maxButtons - 3; }
  if (end > totalPages - 1) { end = totalPages - 1; start = end - maxButtons + 3; }
  for (let p = start; p <= end; p++) pages.add(p);
  const sorted = [...pages].sort((a, b) => a - b);
  const result = [];
  let prev = 0;
  for (const p of sorted) {
    if (p - prev > 1) result.push('...');
    result.push(p);
    prev = p;
  }
  return result;
}
