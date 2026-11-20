<template>
  <div class="app-container">
    <nav class="navbar">
      <div class="navbar-brand">
        <span class="logo-icon">&#9881;</span>
        <span class="brand-text">MES 管理后台</span>
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
        <a class="nav-entry" href="/">车间看板</a>
      </div>
    </nav>

    <main class="main-content">
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
    </main>
  </div>
</template>

<script setup>
import { usePageNav } from '../shared/usePageNav.js';
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

// 后端管理系统：设备 / 产品 / 模具 / 配方 / 参数下发 / 呼叫处理 / 分析与各类配置操作
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
];

const { currentPage, currentTime, switchPage } = usePageNav(navItems, 'device');
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
