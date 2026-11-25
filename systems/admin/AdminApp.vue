<template>
  <div class="app-container">
    <div v-if="!authState.ready" class="auth-loading">正在校验登录状态…</div>

    <template v-else-if="!authState.user">
      <LoginDialog
        :visible="true"
        mode="page"
        title="MES 管理后台登录"
        subtitle="请使用分配的后台账号登录"
        @logged-in="onLoggedIn"
      />
    </template>

    <template v-else>
      <nav class="navbar">
        <div class="navbar-brand">
          <span class="logo-icon">&#9881;</span>
          <span class="brand-text">MES 管理后台</span>
        </div>
        <div v-if="visibleNav.length" class="nav-links">
          <a
            v-for="nav in visibleNav"
            :key="nav.key"
            class="nav-link"
            :class="{ active: currentPage === nav.key }"
            @click="switchPage(nav.key)"
          >{{ nav.label }}</a>
        </div>
        <div class="nav-right">
          <span class="nav-time">{{ currentTime }}</span>
          <a class="nav-entry" href="/">车间看板</a>
          <span class="nav-user" :title="userTitle">{{ userName }}</span>
          <a class="nav-entry" @click="passwordVisible = true">修改密码</a>
          <a class="nav-entry" @click="handleLogout">退出</a>
        </div>
      </nav>

      <main v-if="visibleNav.length" class="main-content">
        <DevicePage v-show="currentPage === 'device'" :active="currentPage === 'device'" />
        <ProductPage v-show="currentPage === 'product'" :active="currentPage === 'product'" />
        <MoldPage v-show="currentPage === 'mold'" :active="currentPage === 'mold'" />
        <RecipePage v-show="currentPage === 'recipe'" :active="currentPage === 'recipe'" view-mode="admin" />
        <PipelinePage v-show="currentPage === 'pipeline'" :active="currentPage === 'pipeline'" view-mode="admin" />
        <AndonPage v-show="currentPage === 'andon'" :active="currentPage === 'andon'" view-mode="admin" />
        <AnalysisPage v-show="currentPage === 'analysis'" :active="currentPage === 'analysis'" />
        <ProcessChartPage v-show="currentPage === 'chart'" :active="currentPage === 'chart'" />
        <StatsPage v-show="currentPage === 'stats'" :active="currentPage === 'stats'" view-mode="admin" />
        <PlanPage v-show="currentPage === 'plan'" :active="currentPage === 'plan'" view-mode="admin" />
        <UserPage v-show="currentPage === 'user'" :active="currentPage === 'user'" />
      </main>

      <main v-else class="main-content">
        <div class="no-permission">
          <div class="no-permission-title">暂无后台访问权限</div>
          <p>当前账号（{{ userName }}）未被分配任何后台管理页面，请联系管理员开通。</p>
          <div class="no-permission-actions">
            <a class="perm-btn" href="/">返回车间看板</a>
            <button class="perm-btn" @click="handleLogout">退出登录</button>
          </div>
        </div>
      </main>

      <ChangePasswordDialog :visible="passwordVisible" @close="passwordVisible = false" />
    </template>
  </div>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { usePageNav } from '../shared/usePageNav.js';
import { authState, canAdminPage, loadAuth, logout } from '../shared/auth';
import LoginDialog from '../shared/LoginDialog.vue';
import ChangePasswordDialog from '../shared/ChangePasswordDialog.vue';
import DevicePage from './pages/DevicePage.vue';
import ProductPage from './pages/ProductPage.vue';
import MoldPage from './pages/MoldPage.vue';
import RecipePage from '../shared/pages/RecipePage.vue';
import AnalysisPage from './pages/AnalysisPage.vue';
import ProcessChartPage from '../shared/pages/ProcessChartPage.vue';
import PipelinePage from '../shared/pages/PipelinePage.vue';
import AndonPage from '../shared/pages/AndonPage.vue';
import StatsPage from '../shared/pages/StatsPage.vue';
import PlanPage from '../shared/pages/PlanPage.vue';
import UserPage from './pages/UserPage.vue';

// 后端管理系统：设备 / 产品 / 模具 / 配方 / 参数下发 / 呼叫处理 / 分析与用户权限
const navItems = [
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

const { currentPage, currentTime, switchPage } = usePageNav(navItems, 'device');
const passwordVisible = ref(false);

const visibleNav = computed(() => navItems.filter((item) => canAdminPage(item.key)));

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

function ensurePagePermitted() {
  if (!authState.user) return;
  if (canAdminPage(currentPage.value)) return;
  const first = navItems.find((item) => canAdminPage(item.key));
  if (first) switchPage(first.key);
}

function onLoggedIn() {
  ensurePagePermitted();
}

async function handleLogout() {
  await logout();
  passwordVisible.value = false;
  // 退出后回到初始界面（车间看板首页），不再停留在后台登录页
  window.location.href = '/';
}

watch(() => authState.ready, ensurePagePermitted);
watch(visibleNav, (list) => {
  if (!list.some((item) => item.key === currentPage.value) && list.length) {
    switchPage(list[0].key);
  }
});

onMounted(async () => {
  await loadAuth();
  ensurePagePermitted();
});
</script>

<style scoped>
.auth-loading {
  padding: 80px 0;
  text-align: center;
  color: #8ba3c7;
  font-size: 14px;
}

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

.nav-user {
  margin-left: 14px;
  font-size: 12px;
  color: #a8b7cc;
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.no-permission {
  margin: 120px auto 0;
  max-width: 520px;
  text-align: center;
  color: #a8b7cc;
}

.no-permission-title {
  font-size: 18px;
  color: #e6edf5;
  margin-bottom: 10px;
}

.no-permission-actions {
  margin-top: 22px;
  display: flex;
  justify-content: center;
  gap: 12px;
}

.perm-btn {
  padding: 8px 18px;
  border-radius: 6px;
  border: 1px solid #2a3a52;
  background: #16202e;
  color: #40a9ff;
  font-size: 14px;
  text-decoration: none;
  cursor: pointer;
}

.perm-btn:hover {
  border-color: #3b82f6;
}
</style>
