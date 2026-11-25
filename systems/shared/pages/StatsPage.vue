<template>
  <section class="page stats">
    <div class="dashboard-header">
      <h1 class="dashboard-title">生产统计</h1>
      <div class="header-actions">
        <span class="mode-tag" :class="mode">{{ modeText }}</span>
        <button v-if="isAdmin && can('stats', 'config')" class="refresh-btn" @click="shiftDialogVisible = true">班次设置</button>
        <button v-if="isAdmin && can('stats', 'config')" class="refresh-btn" @click="askRebuild">重新统计</button>
        <button v-if="isAdmin && can('stats', 'config')" class="refresh-btn" @click="askRebuildAll">全量重算</button>
      </div>
    </div>

    <div class="stats-bar">
      <div class="stat-item">
        <div class="stat-icon total">&#128230;</div>
        <div class="stat-info">
          <div class="stat-num">{{ summary.total }}</div>
          <div class="stat-label">生产总数</div>
        </div>
      </div>
      <div class="stat-item">
        <div class="stat-icon running">&#9989;</div>
        <div class="stat-info">
          <div class="stat-num">{{ summary.qualified }}</div>
          <div class="stat-label">合格数</div>
        </div>
      </div>
      <div class="stat-item">
        <div class="stat-icon warning">&#9888;</div>
        <div class="stat-info">
          <div class="stat-num">{{ summary.warning }}</div>
          <div class="stat-label">预警数</div>
        </div>
      </div>
      <div class="stat-item">
        <div class="stat-icon error">&#10060;</div>
        <div class="stat-info">
          <div class="stat-num">{{ summary.unqualified }}</div>
          <div class="stat-label">不合格数</div>
        </div>
      </div>
      <div class="stat-item">
        <div class="stat-icon offline">&#128200;</div>
        <div class="stat-info">
          <div class="stat-num">{{ summary.qualifiedRate }}%</div>
          <div class="stat-label">合格率</div>
        </div>
      </div>
    </div>

    <div class="tech-data-container">
      <div class="filter-bar">
        <div class="filter-group">
          <label>开始日期</label>
          <input v-model="filter.startDate" type="date" />
        </div>
        <div class="filter-group">
          <label>结束日期</label>
          <input v-model="filter.endDate" type="date" />
        </div>
        <div class="filter-group">
          <label>设备</label>
          <select v-model="filter.device">
            <option value="">全部设备</option>
            <option v-for="d in deviceList" :key="d.device_code" :value="d.device_code">
              {{ d.device_code }} {{ d.device_name }}
            </option>
          </select>
        </div>
        <div class="filter-group" v-if="mode === 'shift'">
          <label>班次</label>
          <select v-model="filter.shift">
            <option value="">全部班次</option>
            <option v-for="s in shifts" :key="s.shift_code" :value="s.shift_code">{{ s.shift_name }}</option>
            <option value="UNASSIGNED">未分班</option>
          </select>
        </div>
        <button class="btn-search" @click="search">查询</button>
        <button class="btn-reset" @click="resetFilter">重置</button>
        <button class="btn-export" title="未设置日期范围时导出最近一个月" @click="exportStats">导出</button>
      </div>

      <div v-if="loading" class="page-hint">数据加载中…</div>
      <div v-else-if="loadError" class="page-hint error">{{ loadError }}</div>

      <div class="data-table-wrapper">
        <div class="data-toolbar">
          <span>共 <b>{{ total }}</b> 条统计记录</span>
          <span v-if="message" class="stats-message">{{ message }}</span>
          <span v-html="paginationInfo"></span>
        </div>

        <div class="table-scroll">
          <table class="data-table">
            <thead>
              <tr>
                <th class="idx-col">序号</th>
                <th>日期</th>
                <th>{{ mode === 'shift' ? '班次' : '统计口径' }}</th>
                <th>设备</th>
                <th>生产数</th>
                <th>合格数</th>
                <th>预警数</th>
                <th>不合格数</th>
                <th>合格率</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(row, idx) in rows" :key="row.id">
                <td class="idx-col">{{ (page - 1) * pageSize + idx + 1 }}</td>
                <td>{{ row.stat_date }}</td>
                <td>
                  <span class="shift-badge" :class="{ unassigned: row.shift_code === 'UNASSIGNED' }">
                    {{ row.shift_name || '全天' }}
                  </span>
                </td>
                <td>
                  {{ row.device_code }}
                  <span class="device-sub">{{ row.device_name || '' }}</span>
                </td>
                <td class="num-cell">{{ row.total_count }}</td>
                <td class="num-cell ok">{{ row.qualified_count }}</td>
                <td class="num-cell warn">{{ row.warning_count }}</td>
                <td class="num-cell err">{{ row.unqualified_count }}</td>
                <td>{{ rowRate(row) }}</td>
              </tr>
              <tr v-if="!rows.length">
                <td colspan="9" style="text-align:center;color:var(--text-secondary);padding:30px 0;">
                  暂无统计数据，请点击「重新统计」生成，或运行定时任务 stats_job.js
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="pagination">
          <div class="pagination-left">
            <span class="pagination-info" v-html="paginationInfo"></span>
            <div class="page-size">
              <span>每页</span>
              <select v-model.number="pageSize" @change="changePageSize">
                <option :value="10">10</option>
                <option :value="20">20</option>
                <option :value="50">50</option>
                <option :value="100">100</option>
              </select>
              <span>条</span>
            </div>
          </div>
          <div class="pagination-btns">
            <button class="page-btn" :disabled="page <= 1" @click="goPage(page - 1)">上一页</button>
            <button
              v-for="p in pageList"
              :key="p"
              class="page-btn"
              :class="{ active: p === page }"
              @click="goPage(p)"
            >{{ p }}</button>
            <button class="page-btn" :disabled="page >= totalPages" @click="goPage(page + 1)">下一页</button>
          </div>
        </div>
      </div>
    </div>

    <ShiftConfigDialog
      :visible="shiftDialogVisible"
      :shifts="shifts"
      @close="shiftDialogVisible = false"
      @changed="onShiftChanged"
    />

    <AppDialog
      :visible="rebuildState.visible"
      :title="rebuildState.title"
      :message="rebuildState.message"
      mode="confirm"
      @confirm="doRebuild"
      @cancel="rebuildState.visible = false"
    />
  </section>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue';
import { apiGet, apiPost, buildPageList } from '../api';
import { can } from '../auth';
import { loadPageState, savePageState } from '../usePageState';
import ShiftConfigDialog from './ShiftConfigDialog.vue';
import AppDialog from '../AppDialog.vue';

const props = defineProps({
  active: { type: Boolean, default: false },
  // display = 前端显示系统（只看统计）；admin = 后端管理系统（含班次设置 / 重新统计）
  viewMode: { type: String, default: 'admin' },
});

const isAdmin = computed(() => props.viewMode !== 'display');

function formatDate(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const today = new Date();
const defaultEnd = formatDate(today);
const weekAgo = new Date(today.getTime() - 6 * 24 * 60 * 60 * 1000);
const defaultStart = formatDate(weekAgo);

const filter = ref({ startDate: defaultStart, endDate: defaultEnd, device: '', shift: '' });
const rows = ref([]);
const deviceList = ref([]);
const shifts = ref([]);
const mode = ref('day');
const total = ref(0);
const page = ref(1);
const pageSize = ref(10);
const totalPages = ref(1);
const pageList = ref([]);
const message = ref('');
const loading = ref(false);
const loadError = ref('');
const shiftDialogVisible = ref(false);
const rebuildState = ref({ visible: false, message: '' });
const summary = ref({ total: 0, qualified: 0, warning: 0, unqualified: 0, qualifiedRate: '0.0' });

const modeText = computed(() => (mode.value === 'shift' ? `按班次统计（${shifts.value.length} 个班次）` : '按天统计（未配置班次）'));

const paginationInfo = computed(() => {
  if (!total.value) return '共 0 条';
  const start = (page.value - 1) * pageSize.value + 1;
  const end = Math.min(page.value * pageSize.value, total.value);
  return `显示 <b>${start}-${end}</b> 条 / 共 <b>${total.value}</b> 条`;
});

function rowRate(row) {
  const t = Number(row.total_count) || 0;
  if (!t) return '--';
  return `${((Number(row.qualified_count) / t) * 100).toFixed(1)}%`;
}

function flash(text) {
  message.value = text;
  setTimeout(() => { if (message.value === text) message.value = ''; }, 4000);
}

async function loadDevices() {
  try {
    const data = await apiGet('/api/devices/options');
    // 未启用设备不参与统计，筛选列表同样不展示
    deviceList.value = (data || []).filter((d) => Number(d.is_active) === 1);
  } catch (e) {
    console.error('加载设备失败', e);
  }
}

async function loadShifts() {
  try {
    const data = await apiGet('/api/stats/shifts');
    shifts.value = (data.shifts || []).filter((s) => Number(s.is_active) === 1);
    mode.value = data.mode || 'day';
    if (mode.value === 'day') filter.value.shift = '';
  } catch (e) {
    console.error('加载班次失败', e);
  }
}

async function loadStats() {
  loading.value = true;
  loadError.value = '';
  try {
    const params = new URLSearchParams();
    params.set('startDate', filter.value.startDate);
    params.set('endDate', filter.value.endDate);
    params.set('page', page.value);
    params.set('pageSize', pageSize.value);
    if (filter.value.device) params.set('device', filter.value.device);
    if (filter.value.shift) params.set('shift', filter.value.shift);

    const data = await apiGet(`/api/stats/list?${params.toString()}`);
    rows.value = data.data || [];
    total.value = data.total || 0;
    totalPages.value = data.totalPages || 1;
    pageList.value = buildPageList(totalPages.value, data.page || page.value);
    summary.value = data.summary || summary.value;
    mode.value = data.mode || mode.value;
    if (data.shifts) shifts.value = data.shifts;
  } catch (e) {
    console.error('加载生产统计失败', e);
    loadError.value = `加载失败：${e.message}（请检查服务是否正常）`;
    rows.value = [];
    total.value = 0;
    pageList.value = [];
  } finally {
    loading.value = false;
  }
}

function search() {
  page.value = 1;
  loadStats();
}

function resetFilter() {
  filter.value = { startDate: defaultStart, endDate: defaultEnd, device: '', shift: '' };
  page.value = 1;
  loadStats();
}

function goPage(p) {
  if (p === '...' || p === page.value) return;
  if (p < 1 || p > totalPages.value) return;
  page.value = p;
  loadStats();
}

// 切换每页条数后回到第一页重新查询
function changePageSize() {
  page.value = 1;
  loadStats();
}

// 导出当前筛选条件下的统计数据；日期仍为默认值时按最近一个月导出
function exportStats() {
  const params = new URLSearchParams();
  const isDefaultRange = filter.value.startDate === defaultStart && filter.value.endDate === defaultEnd;
  if (!isDefaultRange) {
    if (filter.value.startDate) params.set('startDate', filter.value.startDate);
    if (filter.value.endDate) params.set('endDate', filter.value.endDate);
  }
  if (filter.value.device) params.set('device', filter.value.device);
  if (filter.value.shift) params.set('shift', filter.value.shift);
  window.location.href = `/api/stats/export?${params.toString()}`;
}

function askRebuild() {
  rebuildState.value = {
    visible: true,
    title: '重新统计',
    all: false,
    message: `将按当前班次配置重算 ${filter.value.startDate} ~ ${filter.value.endDate} 的产量统计，区间内已有统计会被覆盖；未启用设备的记录不参与统计。`,
  };
}

function askRebuildAll() {
  rebuildState.value = {
    visible: true,
    title: '全量重算',
    all: true,
    message: '将清空现有统计，按工艺数据表 process_data 中的全部记录重新生成（未启用设备的记录不参与统计），是否继续？',
  };
}

async function doRebuild() {
  const all = rebuildState.value.all;
  rebuildState.value.visible = false;
  try {
    const res = await apiPost('/api/stats/rebuild', all
      ? { all: true }
      : { startDate: filter.value.startDate, endDate: filter.value.endDate });
    const skipText = res.skippedRecords ? `，跳过未启用设备记录 ${res.skippedRecords} 条` : '';
    flash(`统计完成：${res.mode === 'shift' ? '按班次' : '按天'}，设备 ${res.deviceCount} 台，写入 ${res.rowCount} 行，来源记录 ${res.sourceRecords} 条${skipText}`);
    page.value = 1;
    await loadStats();
  } catch (e) {
    flash(e.message || '统计失败');
  }
}

async function onShiftChanged() {
  await loadShifts();
  // 班次口径变化后自动按当前区间重算，避免新旧口径混在一起展示
  try {
    const res = await apiPost('/api/stats/rebuild', {
      startDate: filter.value.startDate,
      endDate: filter.value.endDate,
    });
    flash(`班次已更新并重新统计（${res.rowCount} 行）`);
  } catch (e) {
    flash(e.message || '重新统计失败');
  }
  await loadStats();
}

watch(
  () => props.active,
  (val) => {
    if (val) {
      loadDevices();
      loadShifts();
      loadStats();
    }
  }
);

const STATE_KEY = 'stats';
const savedState = loadPageState(STATE_KEY);
if (savedState) {
  filter.value = { ...filter.value, ...(savedState.filter || {}) };
  page.value = savedState.page || 1;
  pageSize.value = savedState.pageSize || 10;
}

watch(
  [filter, page, pageSize],
  () => {
    savePageState(STATE_KEY, {
      filter: filter.value,
      page: page.value,
      pageSize: pageSize.value,
    });
  },
  { deep: true }
);

onMounted(() => {
  if (props.active) {
    loadDevices();
    loadShifts();
    loadStats();
  }
});
</script>

<style scoped>
.header-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.mode-tag {
  font-size: 12px;
  padding: 4px 12px;
  border-radius: 12px;
  background: rgba(24, 144, 255, 0.1);
  border: 1px solid rgba(24, 144, 255, 0.3);
  color: #40a9ff;
}

.mode-tag.day {
  background: rgba(140, 155, 175, 0.12);
  border-color: rgba(140, 155, 175, 0.3);
  color: var(--text-secondary);
}

.stats-message {
  color: #40a9ff;
  font-size: 12px;
}

.shift-badge {
  display: inline-block;
  padding: 1px 10px;
  border-radius: 10px;
  font-size: 12px;
  background: rgba(24, 144, 255, 0.12);
  color: #40a9ff;
}

.shift-badge.unassigned {
  background: rgba(250, 173, 20, 0.15);
  color: #faad14;
}

.device-sub {
  display: block;
  font-size: 11px;
  color: var(--text-secondary);
}

.num-cell {
  font-family: 'Courier New', monospace;
  font-weight: 600;
}

.num-cell.ok { color: #52c41a; }
.num-cell.warn { color: #faad14; }
.num-cell.err { color: #ff787e; }
</style>
