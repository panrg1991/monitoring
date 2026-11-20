<template>
  <div class="app-container">
    <nav class="navbar">
      <div class="navbar-brand">
        <span class="logo-icon">&#9878;</span>
        <span class="brand-text">MES 车间看板</span>
      </div>
      <div class="nav-links">
        <a
          v-for="nav in navItems"
          :key="nav.key"
          class="nav-link"
          :class="{ active: currentPage === nav.key }"
          @click="switchPage(nav.key)"
        >{{ nav.label }}</a>
      </div>
      <div class="nav-right">
        <span class="nav-time">{{ currentTime }}</span>
        <a class="nav-entry" href="/admin">管理后台</a>
      </div>
    </nav>

    <main class="main-content">
      <HomePage v-show="currentPage === 'home'" :active="currentPage === 'home'" />
      <ThermalPage v-show="currentPage === 'thermal'" :active="currentPage === 'thermal'" />
      <PipelinePage v-show="currentPage === 'pipeline'" :active="currentPage === 'pipeline'" view-mode="display" />
      <RecipePage v-show="currentPage === 'recipe'" :active="currentPage === 'recipe'" view-mode="display" />
      <AndonPage v-show="currentPage === 'andon'" :active="currentPage === 'andon'" view-mode="display" />
      <ProcessPage v-show="currentPage === 'process'" :active="currentPage === 'process'" />
      <ProcessChartPage v-show="currentPage === 'chart'" :active="currentPage === 'chart'" />
      <StatsPage v-show="currentPage === 'stats'" :active="currentPage === 'stats'" view-mode="display" />
      <PlanPage v-show="currentPage === 'plan'" :active="currentPage === 'plan'" view-mode="display" />
    </main>
  </div>
</template>

<script setup>
import { usePageNav } from '../shared/usePageNav.js';
import HomePage from './pages/HomePage.vue';
import ThermalPage from './pages/ThermalPage.vue';
import ProcessPage from './pages/ProcessPage.vue';
import ProcessChartPage from '../shared/pages/ProcessChartPage.vue';
import PipelinePage from '../shared/pages/PipelinePage.vue';
import RecipePage from '../shared/pages/RecipePage.vue';
import AndonPage from '../shared/pages/AndonPage.vue';
import StatsPage from '../shared/pages/StatsPage.vue';
import PlanPage from '../shared/pages/PlanPage.vue';

// 前端显示系统：车间看板，只读展示为主（不提供设备维护、配置下发、统计重算等管理操作）
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

const { currentPage, currentTime, switchPage } = usePageNav(navItems, 'home');
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
}

.nav-entry:hover {
  background: rgba(24, 144, 255, 0.12);
  border-color: #40a9ff;
}
</style>
