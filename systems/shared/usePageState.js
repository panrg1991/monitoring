// 列表页筛选 / 分页状态持久化（sessionStorage）
// 目的：F5 刷新或重新进入页面后，保留上次的查询条件与页码
const PREFIX = 'mes_page_state_';

export function loadPageState(key) {
  try {
    const raw = sessionStorage.getItem(PREFIX + key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function savePageState(key, state) {
  try {
    sessionStorage.setItem(PREFIX + key, JSON.stringify(state));
  } catch {
    // 隐私模式或超出配额时忽略
  }
}
