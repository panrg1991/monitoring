<template>
  <section class="page plan-page">
    <div class="dashboard-header">
      <h1 class="dashboard-title">生产计划</h1>
      <div class="header-actions">
        <span class="live-tag" :class="{ paused: !autoRefresh }" @click="toggleAutoRefresh">
          <i class="live-dot"></i>
          {{ autoRefresh ? `实时刷新中 · ${refreshLeft}s` : '实时刷新已暂停' }}
        </span>
        <button v-if="isAdmin && can('plan', 'create')" class="refresh-btn" @click="openCreate">+ 新增计划</button>
      </div>
    </div>

    <div class="stats-bar">
      <div class="stat-item">
        <div class="stat-icon total">&#128203;</div>
        <div class="stat-info">
          <div class="stat-num">{{ summary.draft }}</div>
          <div class="stat-label">起草中</div>
        </div>
      </div>
      <div class="stat-item">
        <div class="stat-icon offline">&#128229;</div>
        <div class="stat-info">
          <div class="stat-num">{{ summary.issued }}</div>
          <div class="stat-label">已下达</div>
        </div>
      </div>
      <div class="stat-item">
        <div class="stat-icon running">&#9881;</div>
        <div class="stat-info">
          <div class="stat-num">{{ summary.running }}</div>
          <div class="stat-label">执行中</div>
        </div>
      </div>
      <div class="stat-item">
        <div class="stat-icon warning">&#9208;</div>
        <div class="stat-info">
          <div class="stat-num">{{ summary.paused }}</div>
          <div class="stat-label">已暂停</div>
        </div>
      </div>
      <div class="stat-item">
        <div class="stat-icon error">&#9989;</div>
        <div class="stat-info">
          <div class="stat-num">{{ summary.completed + summary.closed }}</div>
          <div class="stat-label">完成 / 结案</div>
        </div>
      </div>
      <div class="stat-item">
        <div class="stat-icon total">&#128200;</div>
        <div class="stat-info">
          <div class="stat-num">{{ summary.runningRate }}%</div>
          <div class="stat-label">执行中完成率</div>
        </div>
      </div>
    </div>

    <div class="tech-data-container">
      <div class="filter-bar">
        <div class="filter-group">
          <label>关键字</label>
          <input v-model="filter.keyword" placeholder="计划编号 / 名称 / 设备" @keyup.enter="search" />
        </div>
        <div class="filter-group">
          <label>设备</label>
          <select v-model="filter.device">
            <option value="">全部设备</option>
            <option v-for="d in options.devices" :key="d.device_code" :value="d.device_code">
              {{ d.device_code }} {{ d.device_name }}
            </option>
          </select>
        </div>
        <div class="filter-group">
          <label>状态</label>
          <select v-model="filter.status">
            <option value="">全部状态</option>
            <option value="draft">起草中</option>
            <option value="issued">已下达</option>
            <option value="running">执行中</option>
            <option value="paused">已暂停</option>
            <option value="completed">已完成</option>
            <option value="closed">已结案</option>
            <option value="cancelled">已取消</option>
          </select>
        </div>
        <div class="filter-group">
          <label>开始日期</label>
          <input v-model="filter.startDate" type="date" />
        </div>
        <div class="filter-group">
          <label>结束日期</label>
          <input v-model="filter.endDate" type="date" />
        </div>
        <button class="btn-search" @click="search">搜索</button>
        <button class="btn-reset" @click="resetFilter">重置</button>
        <button class="btn-export" title="未设置日期范围时导出最近一个月" @click="exportPlans">导出</button>
      </div>

      <div v-if="loading" class="page-hint">数据加载中…</div>

      <div class="data-table-wrapper">
        <div class="data-toolbar">
          <span>共 <b>{{ total }}</b> 条计划</span>
          <span v-if="message" class="plan-message">{{ message }}</span>
          <span v-html="paginationInfo"></span>
        </div>

        <div class="table-scroll">
          <table class="data-table">
            <thead>
              <tr>
                <th class="idx-col">序号</th>
                <th>计划编号</th>
                <th>计划名称</th>
                <th>设备</th>
                <th>产品</th>
                <th>计划数</th>
                <th>已完成</th>
                <th style="min-width:190px;">完成率</th>
                <th>计划周期</th>
                <th style="width:150px;">实际开始 / 结束</th>
                <th>状态</th>
                <th style="width:300px;">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(p, idx) in rows" :key="p.id">
                <td class="idx-col">{{ (page - 1) * pageSize + idx + 1 }}</td>
                <td class="code-cell">{{ p.plan_code }}</td>
                <td>{{ p.plan_name || '--' }}</td>
                <td>
                  {{ p.device_code }}
                  <span class="device-sub">{{ p.device_name || '' }}</span>
                </td>
                <td>{{ p.product_model || '全部产品' }}</td>
                <td class="num-cell">{{ p.plan_count }}</td>
                <td class="num-cell ok">
                  {{ p.actual_count }}
                  <span class="sub-text">合格 {{ p.qualified_count }}</span>
                </td>
                <td>
                  <div class="progress">
                    <div class="progress-bar" :class="rateClass(p)" :style="{ width: progressWidth(p) }"></div>
                  </div>
                  <span class="rate-text">{{ p.rate_percent }}%</span>
                </td>
                <td class="time-cell">
                  {{ shortTime(p.start_time) }}<br />
                  {{ shortTime(p.end_time) }}
                </td>
                <td class="time-cell actual-cell">
                  <span :title="p.exec_start_at || p.started_at || ''">{{ shortTime(p.exec_start_at || p.started_at) }}</span><br />
                  <span :title="p.exec_end_at || p.completed_at || ''">{{ shortTime(p.exec_end_at || p.completed_at) }}</span>
                </td>
                <td>
                  <span class="status-tag" :class="statusClass(p)">{{ statusText(p) }}</span>
                </td>
                <td>
                  <template v-if="isAdmin">
                    <button class="link-btn" @click="openRecords(p)">查询</button>
                    <!-- 起草：编辑 / 下达 / 取消 -->
                    <button v-if="p.status === 'draft' && can('plan', 'update')" class="link-btn" @click="openEdit(p)">编辑</button>
                    <button v-if="p.status === 'draft' && can('plan', 'operate')" class="link-btn" @click="changeStatus(p, 'issued', '已下达')">下达</button>
                    <button v-if="p.status === 'draft' && can('plan', 'operate')" class="link-btn" @click="changeStatus(p, 'cancelled', '已取消')">取消</button>
                    <!-- 已下达：开始执行 / 撤回为起草 / 取消 -->
                    <button v-if="p.status === 'issued' && can('plan', 'operate')" class="link-btn" @click="askStart(p)">开始</button>
                    <button v-if="p.status === 'issued' && can('plan', 'operate')" class="link-btn" @click="changeStatus(p, 'draft', '已撤回为起草')">撤回</button>
                    <button v-if="p.status === 'issued' && can('plan', 'operate')" class="link-btn" @click="changeStatus(p, 'cancelled', '已取消')">取消</button>
                    <!-- 执行中：暂停 / 完成 -->
                    <button v-if="p.status === 'running' && can('plan', 'update')" class="link-btn" @click="openEdit(p)">编辑</button>
                    <button v-if="p.status === 'running' && can('plan', 'operate')" class="link-btn" @click="askPause(p)">暂停</button>
                    <button v-if="p.status === 'running' && can('plan', 'operate')" class="link-btn" @click="askComplete(p)">完成</button>
                    <!-- 已暂停：恢复执行 / 取消 -->
                    <button v-if="p.status === 'paused' && can('plan', 'update')" class="link-btn" @click="openEdit(p)">编辑</button>
                    <button v-if="p.status === 'paused' && can('plan', 'operate')" class="link-btn" @click="changeStatus(p, 'running', '已恢复执行')">恢复</button>
                    <button v-if="p.status === 'paused' && can('plan', 'operate')" class="link-btn" @click="changeStatus(p, 'cancelled', '已取消')">取消</button>
                    <!-- 已完成：结案 -->
                    <button v-if="p.status === 'completed' && can('plan', 'operate')" class="link-btn" @click="changeStatus(p, 'closed', '已结案')">结案</button>
                    <!-- 已取消：恢复为起草 -->
                    <button v-if="p.status === 'cancelled' && can('plan', 'operate')" class="link-btn" @click="changeStatus(p, 'draft', '已恢复为起草')">恢复起草</button>
                    <button v-if="canDelete(p) && can('plan', 'delete')" class="link-btn danger" @click="askDelete(p)">删除</button>
                  </template>
                  <span v-else class="sub-text">--</span>
                </td>
              </tr>
              <tr v-if="!rows.length">
                <td colspan="12" style="text-align:center;color:var(--text-secondary);padding:30px 0;">
                  暂无生产计划，点击「新增计划」创建起草计划，下达后开始执行
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

    <PlanEditDialog
      :visible="dialogVisible"
      :plan="editingPlan"
      :options="options"
      @close="dialogVisible = false"
      @saved="onSaved"
    />

    <AppDialog
      :visible="confirmState.visible"
      title="删除计划"
      :message="confirmState.message"
      mode="confirm"
      @confirm="handleDelete"
      @cancel="confirmState.visible = false"
    />

    <PlanRecordsDialog
      :visible="recordsState.visible"
      :plan="recordsState.plan"
      @close="recordsState.visible = false"
    />

    <AppDialog
      :visible="pauseState.visible"
      title="暂停计划"
      :message="pauseState.message"
      mode="input"
      placeholder="请填写暂停原因（必填）"
      @confirm="handlePause"
      @cancel="pauseState.visible = false"
    />

    <AppDialog
      :visible="startState.visible"
      title="开始执行计划"
      :message="startState.message"
      mode="input"
      input-type="datetime-local"
      :default-value="startState.defaultValue"
      @confirm="handleStart"
      @cancel="startState.visible = false"
    />

    <AppDialog
      :visible="completeState.visible"
      title="完成计划"
      :message="completeState.message"
      mode="input"
      input-type="datetime-local"
      :default-value="completeState.defaultValue"
      @confirm="handleComplete"
      @cancel="completeState.visible = false"
    />
  </section>
</template>

<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue';
import { apiGet, apiPost, buildPageList } from '../api';
import { can } from '../auth';
import { loadPageState, savePageState } from '../usePageState';
import PlanEditDialog from './PlanEditDialog.vue';
import PlanRecordsDialog from './PlanRecordsDialog.vue';
import AppDialog from '../AppDialog.vue';

const props = defineProps({
  active: { type: Boolean, default: false },
  // display = 前端显示系统（只看进度）；admin = 后端管理系统（可新增 / 编辑 / 结束 / 删除）
  viewMode: { type: String, default: 'admin' },
});

const isAdmin = computed(() => props.viewMode !== 'display');

const REFRESH_SECONDS = 15;

const rows = ref([]);
const options = ref({ devices: [], products: [] });
const summary = ref({
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
});
const filter = ref({ keyword: '', device: '', status: '', startDate: '', endDate: '' });
const total = ref(0);
const page = ref(1);
const pageSize = ref(10);
const totalPages = ref(1);
const pageList = ref([]);
const message = ref('');
const loading = ref(false);
const dialogVisible = ref(false);
const editingPlan = ref(null);
const confirmState = ref({ visible: false, message: '', plan: null });
const pauseState = ref({ visible: false, message: '', plan: null });
const recordsState = ref({ visible: false, plan: null });
const startState = ref({ visible: false, message: '', plan: null, defaultValue: '' });
const completeState = ref({ visible: false, message: '', plan: null, defaultValue: '' });
const autoRefresh = ref(true);
const refreshLeft = ref(REFRESH_SECONDS);

let timer = null;

const paginationInfo = computed(() => {
  if (!total.value) return '共 0 条';
  const start = (page.value - 1) * pageSize.value + 1;
  const end = Math.min(page.value * pageSize.value, total.value);
  return `显示 <b>${start}-${end}</b> 条 / 共 <b>${total.value}</b> 条`;
});

function flash(text) {
  message.value = text;
  setTimeout(() => { if (message.value === text) message.value = ''; }, 4000);
}

function shortTime(value) {
  const s = String(value || '');
  return s.length >= 16 ? `${s.slice(5, 10)} ${s.slice(11, 16)}` : s;
}

const STATUS_TEXT = {
  draft: '起草中',
  issued: '已下达',
  running: '执行中',
  paused: '已暂停',
  completed: '已完成',
  closed: '已结案',
  cancelled: '已取消',
};

const STATUS_CLASS = {
  draft: 'draft',
  issued: 'issued',
  running: 'running',
  paused: 'paused',
  completed: 'done',
  closed: 'closed',
  cancelled: 'cancel',
};

function statusText(p) {
  if (Number(p.overdue) === 1) {
    if (p.status === 'running') return '已超期';
    if (p.status === 'issued') return '逾期未执行';
  }
  return STATUS_TEXT[p.status] || p.status;
}

function statusClass(p) {
  if (Number(p.overdue) === 1 && ['running', 'issued'].includes(p.status)) return 'overdue';
  return STATUS_CLASS[p.status] || 'cancel';
}

// 仅起草 / 已取消的计划可删除，其余需先取消
function canDelete(p) {
  return p.status === 'draft' || p.status === 'cancelled';
}

function progressWidth(p) {
  const value = Math.min(Number(p.rate_percent) || 0, 100);
  return `${value}%`;
}

function rateClass(p) {
  const rate = Number(p.rate_percent) || 0;
  if (p.status === 'cancelled') return 'muted';
  if (rate >= 100) return 'full';
  if (Number(p.overdue) === 1) return 'late';
  return 'normal';
}

async function loadOptions() {
  try {
    const data = await apiGet('/api/plans/options');
    options.value = {
      devices: data.devices || [],
      products: data.products || [],
    };
  } catch (e) {
    console.error('加载计划选项失败', e);
  }
}

async function loadPlans(silent = false) {
  if (!silent) loading.value = true;
  try {
    const params = new URLSearchParams();
    if (filter.value.keyword) params.set('keyword', filter.value.keyword);
    if (filter.value.device) params.set('device', filter.value.device);
    if (filter.value.status) params.set('status', filter.value.status);
    if (filter.value.startDate) params.set('startDate', filter.value.startDate);
    if (filter.value.endDate) params.set('endDate', filter.value.endDate);
    params.set('page', page.value);
    params.set('pageSize', pageSize.value);

    const data = await apiGet(`/api/plans/list?${params.toString()}`);
    rows.value = data.data || [];
    total.value = data.total || 0;
    totalPages.value = data.totalPages || 1;
    pageList.value = buildPageList(totalPages.value, data.page || page.value);
    summary.value = data.summary || summary.value;
    if (!silent) refreshLeft.value = REFRESH_SECONDS;
  } catch (e) {
    if (!silent) flash(e.message || '加载计划失败');
  } finally {
    if (!silent) loading.value = false;
  }
}

function search() {
  page.value = 1;
  loadPlans();
}

function resetFilter() {
  filter.value = { keyword: '', device: '', status: '', startDate: '', endDate: '' };
  page.value = 1;
  loadPlans();
}

function goPage(p) {
  if (p === '...' || p === page.value) return;
  if (p < 1 || p > totalPages.value) return;
  page.value = p;
  loadPlans();
}

// 切换每页条数后回到第一页重新查询
function changePageSize() {
  page.value = 1;
  loadPlans();
}

// 导出当前筛选条件下的计划；未设置日期范围时后端默认导出最近一个月
function exportPlans() {
  const params = new URLSearchParams();
  if (filter.value.keyword) params.set('keyword', filter.value.keyword);
  if (filter.value.device) params.set('device', filter.value.device);
  if (filter.value.status) params.set('status', filter.value.status);
  if (filter.value.startDate) params.set('startDate', filter.value.startDate);
  if (filter.value.endDate) params.set('endDate', filter.value.endDate);
  window.location.href = `/api/plans/export?${params.toString()}`;
}

function openCreate() {
  editingPlan.value = null;
  dialogVisible.value = true;
}

function openEdit(plan) {
  editingPlan.value = plan;
  dialogVisible.value = true;
}

// 查询该计划关联的工艺数据（与完成数统计口径一致）
function openRecords(plan) {
  recordsState.value = { visible: true, plan };
}

function onSaved() {
  flash('计划已保存');
  loadPlans(true);
}

async function changeStatus(plan, status, text) {
  try {
    await apiPost('/api/plans/status', { id: plan.id, status });
    flash(`计划【${plan.plan_code}】${text}`);
    loadPlans(true);
  } catch (e) {
    flash(e.message || '操作失败');
  }
}

// datetime-local 的当前值（YYYY-MM-DDTHH:mm）
function nowLocalInput() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
    + `T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// 开始执行：默认当前时间，可回填为实际开始时间（补录场景）
function askStart(plan) {
  startState.value = {
    visible: true,
    plan,
    defaultValue: nowLocalInput(),
    message: `开始执行计划【${plan.plan_code}${plan.plan_name ? ' ' + plan.plan_name : ''}】，如需补录请改为实际开始时间：`,
  };
}

async function handleStart(value) {
  const plan = startState.value.plan;
  const occurred = String(value || '').trim();
  if (!occurred) {
    flash('请填写开始执行时间');
    return;
  }
  startState.value.visible = false;
  if (!plan) return;
  try {
    await apiPost('/api/plans/status', { id: plan.id, status: 'running', occurred_at: occurred });
    flash(`计划【${plan.plan_code}】已开始执行`);
    loadPlans(true);
  } catch (e) {
    flash(e.message || '操作失败');
  }
}

// 完成：默认当前时间，可回填为实际完成时间
function askComplete(plan) {
  completeState.value = {
    visible: true,
    plan,
    defaultValue: nowLocalInput(),
    message: `完成计划【${plan.plan_code}${plan.plan_name ? ' ' + plan.plan_name : ''}】，请确认实际完成时间（需晚于本次开始执行时间）：`,
  };
}

async function handleComplete(value) {
  const plan = completeState.value.plan;
  const occurred = String(value || '').trim();
  if (!occurred) {
    flash('请填写完成时间');
    return;
  }
  completeState.value.visible = false;
  if (!plan) return;
  try {
    await apiPost('/api/plans/status', { id: plan.id, status: 'completed', occurred_at: occurred });
    flash(`计划【${plan.plan_code}】已完成`);
    loadPlans(true);
  } catch (e) {
    flash(e.message || '操作失败');
  }
}

// 暂停计划：必须填写暂停原因（异常说明），写入流转日志
function askPause(plan) {
  pauseState.value = {
    visible: true,
    plan,
    message: `暂停计划【${plan.plan_code}${plan.plan_name ? ' ' + plan.plan_name : ''}】，请填写暂停原因：`,
  };
}

async function handlePause(reason) {
  const plan = pauseState.value.plan;
  const remark = String(reason || '').trim();
  if (!remark) {
    flash('请填写暂停原因');
    return;
  }
  pauseState.value.visible = false;
  if (!plan) return;
  try {
    await apiPost('/api/plans/status', { id: plan.id, status: 'paused', remark });
    flash(`计划【${plan.plan_code}】已暂停`);
    loadPlans(true);
  } catch (e) {
    flash(e.message || '暂停失败');
  }
}

function askDelete(plan) {
  confirmState.value = {
    visible: true,
    plan,
    message: `确定删除计划【${plan.plan_code}${plan.plan_name ? ' ' + plan.plan_name : ''}】？删除后不可恢复。`,
  };
}

async function handleDelete() {
  const plan = confirmState.value.plan;
  confirmState.value.visible = false;
  if (!plan) return;
  try {
    await apiPost('/api/plans/delete', { id: plan.id });
    flash(`计划【${plan.plan_code}】已删除`);
    loadPlans(true);
  } catch (e) {
    flash(e.message || '删除失败');
  }
}

function stopTimer() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

function startTimer() {
  stopTimer();
  refreshLeft.value = REFRESH_SECONDS;
  timer = setInterval(() => {
    if (!autoRefresh.value) return;
    refreshLeft.value -= 1;
    if (refreshLeft.value <= 0) {
      refreshLeft.value = REFRESH_SECONDS;
      loadPlans(true);
    }
  }, 1000);
}

function toggleAutoRefresh() {
  autoRefresh.value = !autoRefresh.value;
  if (autoRefresh.value) refreshLeft.value = REFRESH_SECONDS;
}

watch(
  () => props.active,
  (val) => {
    if (val) {
      loadOptions();
      loadPlans();
      startTimer();
    } else {
      stopTimer();
    }
  }
);

const STATE_KEY = 'plan';
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
    loadOptions();
    loadPlans();
    startTimer();
  }
});

onBeforeUnmount(stopTimer);
</script>

<style scoped>
.header-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.live-tag {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 12px;
  border-radius: 12px;
  font-size: 12px;
  color: #52c41a;
  background: rgba(82, 196, 26, 0.1);
  border: 1px solid rgba(82, 196, 26, 0.3);
  cursor: pointer;
  user-select: none;
}

.live-tag.paused {
  color: #8ba3c7;
  background: rgba(140, 155, 175, 0.12);
  border-color: rgba(140, 155, 175, 0.3);
}

.live-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
  animation: pulse 1.6s infinite;
}

.live-tag.paused .live-dot {
  animation: none;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.25; }
}

.plan-message {
  color: #40a9ff;
  font-size: 12px;
}

.code-cell {
  font-family: 'Courier New', monospace;
  color: #40a9ff;
  white-space: nowrap;
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

.sub-text {
  display: block;
  font-size: 11px;
  font-weight: 400;
  color: var(--text-secondary);
}

.time-cell {
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-secondary);
  white-space: nowrap;
}

.progress {
  height: 6px;
  border-radius: 4px;
  background: rgba(140, 155, 175, 0.18);
  overflow: hidden;
}

.progress-bar {
  height: 100%;
  border-radius: 4px;
  transition: width 0.4s ease;
}

.progress-bar.normal { background: linear-gradient(90deg, #1890ff, #40a9ff); }
.progress-bar.full { background: linear-gradient(90deg, #52c41a, #95de64); }
.progress-bar.late { background: linear-gradient(90deg, #d48806, #faad14); }
.progress-bar.muted { background: #5a6b80; }

.rate-text {
  display: inline-block;
  margin-top: 4px;
  font-size: 12px;
  color: var(--text-secondary);
}

.status-tag {
  display: inline-block;
  padding: 1px 10px;
  border-radius: 10px;
  font-size: 12px;
  white-space: nowrap;
}

.status-tag.draft { background: rgba(140, 155, 175, 0.15); color: #9aa8bb; }
.status-tag.issued { background: rgba(59, 130, 246, 0.15); color: #6ea8ff; }
.status-tag.running { background: rgba(24, 144, 255, 0.12); color: #40a9ff; }
.status-tag.paused { background: rgba(250, 173, 20, 0.15); color: #faad14; }
.status-tag.done { background: rgba(82, 196, 26, 0.15); color: #52c41a; }
.status-tag.closed { background: rgba(82, 196, 26, 0.08); color: #7bc96f; }
.status-tag.overdue { background: rgba(250, 173, 20, 0.15); color: #faad14; }
.status-tag.cancel { background: rgba(140, 155, 175, 0.15); color: #8ba3c7; }

.link-btn {
  background: none;
  border: none;
  color: #40a9ff;
  font-size: 13px;
  cursor: pointer;
  padding: 2px 6px;
}

.link-btn:hover { text-decoration: underline; }
.link-btn.danger { color: #ff787e; }

</style>
