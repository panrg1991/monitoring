// API 请求工具
async function parseResponse(res) {
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) {
    const msg = (data && data.error) || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

export async function apiGet(url) {
  const res = await fetch(url);
  return parseResponse(res);
}

const TOKEN_KEY = 'mes_admin_token';

export function setAdminToken(token) {
  try {
    localStorage.setItem(TOKEN_KEY, String(token || ''));
  } catch {
    // 隐私模式下 localStorage 不可用时忽略
  }
}

function getAdminToken() {
  try {
    return localStorage.getItem(TOKEN_KEY) || '';
  } catch {
    return '';
  }
}

// 从地址栏 ?token= 读取一次并保存，随后清理 URL，避免凭据留在浏览器历史里
export function initAdminTokenFromUrl() {
  try {
    const url = new URL(window.location.href);
    const token = url.searchParams.get('token');
    if (!token) return;
    setAdminToken(token);
    url.searchParams.delete('token');
    window.history.replaceState({}, '', `${url.pathname}${url.hash}`);
  } catch {
    // 忽略解析异常
  }
}

export async function apiPost(url, body) {
  const headers = { 'Content-Type': 'application/json' };
  const token = getAdminToken();
  if (token) headers['X-Admin-Token'] = token;
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body || {}),
  });
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
