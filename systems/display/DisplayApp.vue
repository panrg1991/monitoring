<template>
  <div class="app-container">
    <nav class="navbar">
      <div class="navbar-brand">
        <span class="logo-icon">&#9878;</span>
        <span class="brand-text">MES 车间看板</span>
      </div>
      <div v-if="authState.ready" class="nav-links">
        <a
          v-for="nav in navItems"
          v-show="canDisplayPage(nav.key)"
          :key="nav.key"
          class="nav-link"
          :class="{ active: currentPage === nav.key }"
          @click="switchPage(nav.key)"
        >{{ nav.label }}</a>
      </div>
      <div class="nav-right">
        <span class="nav-time">{{ currentTime }}</span>
        <template v-if="authState.ready">
          <a v-if="showAdminEntry" class="nav-entry" href="/admin">管理后台</a>
          <template v-if="authState.user">
            <span class="nav-user" :title="userTitle">{{ userName }}</span>
            <a class="nav-entry" @click="passwordVisible = true">修改密码</a>
            <a class="nav-entry" @click="handleLogout">退出</a>
          </template>
          <a v-else class="nav-entry login-entry" @click="loginVisible = true">登录</a>
        </template>
      </div>
    </nav>

    <main class="main-content">
      <HomePage v-show="currentPage === 'home'" :active="currentPage === 'home'" />
      <ThermalPage v-show="currentPage === 'thermal' && canDisplayPage('thermal')" :active="currentPage === 'thermal'" />
      <PipelinePage v-show="currentPage === 'pipeline' && canDisplayPage('pipeline')" :active="currentPage === 'pipeline'" view-mode="display" />
      <RecipePage v-show="currentPage === 'recipe' && canDisplayPage('recipe')" :active="currentPage === 'recipe'" view-mode="display" />
      <AndonPage v-show="currentPage === 'andon' && canDisplayPage('andon')" :active="currentPage === 'andon'" view-mode="display" />
      <ProcessPage v-show="currentPage === 'process' && canDisplayPage('process')" :active="currentPage === 'process'" />
      <ProcessChartPage v-show="currentPage === 'chart' && canDisplayPage('chart')" :active="currentPage === 'chart'" />
      <StatsPage v-show="currentPage === 'stats' && canDisplayPage('stats')" :active="currentPage === 'stats'" view-mode="display" />
      <PlanPage v-show="currentPage === 'plan' && canDisplayPage('plan')" :active="currentPage === 'plan'" view-mode="display" />
    </main>

    <LoginDialog
      :visible="loginVisible"
      mode="modal"
      title="MES 车间看板登录"
      subtitle="登录后可查看已授权的看板模块"
      @close="loginVisible = false"
      @logged-in="onLoggedIn"
    />
    <ChangePasswordDialog :visible="passwordVisible" @close="passwordVisible = false" />
  </div>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { usePageNav } from '../shared/usePageNav.js';
import { authState, canAdminPage, canDisplayPage, loadAuth, logout } from '../shared/auth';
import LoginDialog from '../shared/LoginDialog.vue';
import ChangePasswordDialog from '../shared/ChangePasswordDialog.vue';
import HomePage from './pages/HomePage.vue';
import ThermalPage from './pages/ThermalPage.vue';
import ProcessPage from './pages/ProcessPage.vue';
import ProcessChartPage from '../shared/pages/ProcessChartPage.vue';
import PipelinePage from '../shared/pages/PipelinePage.vue';
import RecipePage from '../shared/pages/RecipePage.vue';
import AndonPage from '../shared/pages/AndonPage.vue';
import StatsPage from '../shared/pages/StatsPage.vue';
import PlanPage from '../shared/pages/PlanPage.vue';

// 前端显示系统：车间看板，只读展示为主（未登录仅展示首页与登录按钮）
const navItems = [
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

const ADMIN_KEYS = ['device', 'product', 'mold', 'recipe', 'pipeline', 'andon', 'analysis', 'chart', 'stats', 'plan', 'user'];

const { currentPage, currentTime, switchPage } = usePageNav(navItems, 'home');
const loginVisible = ref(false);
const passwordVisible = ref(false);

const userName = computed(() => {
  const user = authState.user;
  if (!user) return '';
  return user.display_name || user.username;
});

const userTitle = computed(() => {
  const user = authState.user;
  if (!user) return '';
  return `${user.username}${user.is_super ? '（超级管理员）' : ''}`;
});

const showAdminEntry = computed(() => {
  if (!authState.user) return false;
  if (authState.user.is_super) return true;
  return ADMIN_KEYS.some((key) => canAdminPage(key));
});

// 登录 / 退出后，当前页若已无权限则回到第一个可用页面
function ensurePagePermitted() {
  if (canDisplayPage(currentPage.value)) return;
  const fallback = navItems.find((item) => canDisplayPage(item.key));
  if (fallback) switchPage(fallback.key);
}

function onLoggedIn() {
  ensurePagePermitted();
}

async function handleLogout() {
  await logout();
  passwordVisible.value = false;
  loginVisible.value = false;
  // 退出后回到初始界面：看板首页，且地址栏不残留上一个模块的 hash
  switchPage('home');
  window.history.replaceState(null, '', window.location.pathname || '/');
}

watch(() => authState.ready, ensurePagePermitted);

onMounted(async () => {
  await loadAuth();
  ensurePagePermitted();
});
</script>

<style scoped>
.nav-entry {
  margin-left: 14px;
  padding: 4px 10px;
  border: 1px solid rgba(24, 144, 255, 0.35);
  border-radius: 12px;
  font-size: 12px;
  color: #40a9ff;
  text-decoration: none;
  transition: all 0.2s ease;
  cursor: pointer;
}

.nav-entry:hover {
  background: rgba(24, 144, 255, 0.12);
  border-color: #40a9ff;
}

.nav-entry.login-entry {
  border-color: rgba(82, 196, 26, 0.45);
  color: #7ee787;
}

.nav-user {
  margin-left: 14px;
  font-size: 12px;
  color: #a8b7cc;
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  vertical-align: middle;
}
</style>
