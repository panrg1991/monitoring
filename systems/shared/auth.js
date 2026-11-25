// 登录态与权限（前端）：集中管理当前用户、页面可见性与按钮动作权限
import { computed, reactive } from 'vue';
import { apiGet, apiPost, setUnauthorizedHandler } from './api';

// 未登录也能看到的看板页面（需求：未登录仅看首页 + 登录按钮）
export const GUEST_DISPLAY_PAGES = ['home'];

const state = reactive({
  ready: false,
  loading: false,
  user: null,
  meta: { display_pages: [], admin_pages: [], actions: [] },
});

export const authState = state;

export const isLoggedIn = computed(() => !!state.user);
export const isSuperUser = computed(() => !!(state.user && state.user.is_super));

function ownList(list) {
  return Array.isArray(list) ? list : [];
}

// 当前用户的看板页面 / 后台页面 / 动作权限
const displayPages = computed(() => (state.user ? ownList(state.user.display_pages) : []));
const adminPages = computed(() => (state.user ? ownList(state.user.admin_pages) : []));
const actionKeys = computed(() => (state.user ? ownList(state.user.actions) : []));

function applyAuthPayload(data) {
  if (data && data.meta) state.meta = data.meta;
  state.user = (data && data.user) || null;
}

export async function loadAuth() {
  try {
    const data = await apiGet('/api/auth/me');
    applyAuthPayload(data);
  } catch {
    state.user = null;
  } finally {
    state.ready = true;
  }
  return state.user;
}

export async function login(username, password) {
  state.loading = true;
  try {
    const data = await apiPost('/api/auth/login', { username, password });
    applyAuthPayload(data);
    return state.user;
  } finally {
    state.loading = false;
  }
}

export async function logout() {
  try {
    await apiPost('/api/auth/logout', {});
  } catch {
    // 会话已失效时忽略错误，本地状态照常清理
  }
  state.user = null;
}

// 看板页面是否可见：未登录时只有首页
export function canDisplayPage(key) {
  if (!state.user) return GUEST_DISPLAY_PAGES.includes(key);
  if (state.user.is_super) return true;
  return displayPages.value.includes(key);
}

// 后台页面是否可见
export function canAdminPage(key) {
  if (!state.user) return false;
  if (state.user.is_super) return true;
  return adminPages.value.includes(key);
}

// 按钮级权限：超级管理员拥有全部动作
export function can(module, action) {
  if (!state.user) return false;
  if (state.user.is_super) return true;
  return actionKeys.value.includes(`${module}:${action}`);
}

// 批量判断（任一命中即返回 true）
export function canAny(pairs) {
  return (pairs || []).some(([module, action]) => can(module, action));
}

export function isSuper() {
  return !!(state.user && state.user.is_super);
}

// 会话失效（401）时清理本地登录态
setUnauthorizedHandler(() => {
  state.user = null;
});
