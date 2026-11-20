<template>
  <section class="page process">
    <div class="dashboard-header">
      <h1 class="dashboard-title">工艺数据查询</h1>
    </div>

    <div class="tech-data-container">
      <div class="filter-bar">
        <div class="filter-group">
          <label>设备</label>
          <select v-model="processFilter.device">
            <option value="">全部设备</option>
            <option v-for="d in processFilters.deviceList" :key="d.device_code" :value="d.device_code">
              {{ d.device_code }} {{ d.device_name }}
            </option>
          </select>
        </div>
        <div class="filter-group">
          <label>产品型号</label>
          <select v-model="processFilter.product">
            <option value="">全部产品</option>
            <option v-for="p in processFilters.products" :key="p" :value="p">{{ p }}</option>
          </select>
        </div>
        <div class="filter-group">
          <label>批次号</label>
          <input v-model="processFilter.batch" placeholder="请输入批次号" @keyup.enter="searchProcessData" />
        </div>
        <div class="filter-group">
          <label>开始时间</label>
          <input v-model="processFilter.startTime" type="datetime-local" />
        </div>
        <div class="filter-group">
          <label>结束时间</label>
          <input v-model="processFilter.endTime" type="datetime-local" />
        </div>
        <div class="filter-group">
          <label>状态</label>
          <select v-model="processFilter.status">
            <option value="">全部状态</option>
            <option value="normal">正常</option>
            <option value="warning">预警</option>
            <option value="unqualified">不合格</option>
          </select>
        </div>
        <button class="btn-search" @click="searchProcessData">搜索</button>
        <button class="btn-reset" @click="resetProcessFilter">重置</button>
        <button class="btn-export" title="未设置时间范围时导出最近一个月" @click="exportProcessData">导出</button>
      </div>

      <div v-if="processLoading" class="page-hint">数据加载中…</div>
      <div v-else-if="processError" class="page-hint error">{{ processError }}</div>

      <div class="data-table-wrapper">
        <div class="data-toolbar">
          <span>共 <b>{{ processResult.total }}</b> 条记录</span>
          <span v-html="processPaginationInfo"></span>
        </div>
        <HScrollBar :target="processScrollEl" />

        <div ref="processScrollEl" class="table-scroll no-native-scrollbar">
          <table class="data-table process-table" :style="{ width: processTableWidth + 'px' }">
            <!-- 固定列宽：基础列固定宽度，参数列由工艺参数清单动态生成，一屏放不下时横向滑动查看 -->
            <colgroup>
              <col style="width:56px" />
              <col style="width:130px" />
              <col style="width:100px" />
              <col style="width:110px" />
              <col style="width:150px" />
              <col style="width:150px" />
              <col style="width:90px" />
              <col v-for="p in processParams" :key="'col-' + p.param_key" style="width:110px" />
            </colgroup>
            <thead>
              <tr>
                <th class="idx-col">序号</th>
                <th>设备</th>
                <th>产品</th>
                <th>批次</th>
                <th>工件编号</th>
                <th>采集时间</th>
                <th>状态</th>
                <th v-for="p in processParams" :key="p.param_key">{{ p.param_name }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(row, idx) in processResult.data" :key="row.id">
                <td class="idx-col">
                  {{ (processResult.page - 1) * (processResult.pageSize || processPageSize) + idx + 1 }}
                </td>
                <td>
                  {{ row.device_code }}
                  <span class="device-sub">{{ deviceName(row.device_code) }}</span>
                </td>
                <td>{{ row.product_model }}</td>
                <td>{{ row.batch_no }}</td>
                <td>{{ row.workpiece_no || '--' }}</td>
                <td>{{ row.collect_time }}</td>
                <td v-html="processStatusHtml(row.data_status)"></td>
                <td v-for="p in processParams" :key="p.param_key">
                  {{ row[p.param_key] === null || row[p.param_key] === undefined || row[p.param_key] === '' ? '--' : row[p.param_key] }}
                </td>
              </tr>
              <tr v-if="!processResult.data || !processResult.data.length">
                <td :colspan="processParams.length + 7" style="text-align:center;color:var(--text-secondary);padding:30px 0;">暂无数据</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="pagination">
          <div class="pagination-left">
            <span class="pagination-info" v-html="processPaginationInfo"></span>
            <div class="page-size">
              <span>每页</span>
              <select v-model.number="processPageSize" @change="changeProcessPageSize">
                <option :value="10">10</option>
                <option :value="20">20</option>
                <option :value="50">50</option>
                <option :value="100">100</option>
              </select>
              <span>条</span>
            </div>
          </div>
          <div class="pagination-btns">
            <button class="page-btn" :disabled="processPage <= 1" @click="goProcessPage(processPage - 1)">上一页</button>
            <button
              v-for="p in processPages"
              :key="p"
              class="page-btn"
              :class="{ active: p === processPage }"
              @click="goProcessPage(p)"
            >{{ p }}</button>
            <button class="page-btn" :disabled="processPage >= processTotalPages" @click="goProcessPage(processPage + 1)">下一页</button>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue';
import { apiGet, buildPageList, escapeHtml } from '../../shared/api';
import { loadPageState, savePageState } from '../../shared/usePageState';
import HScrollBar from '../../shared/HScrollBar.vue';

const props = defineProps({
  active: { type: Boolean, default: false },
});

const processFilters = ref({ devices: [], deviceList: [], products: [] });
const processFilter = ref({ device: '', product: '', batch: '', startTime: '', endTime: '', status: '' });
const processScrollEl = ref(null);
const processResult = ref({ total: 0, page: 1, pageSize: 10, data: [] });
const processPage = ref(1);
const processPageSize = ref(10);
const processTotalPages = ref(1);
const processPages = ref([]);
const processLoading = ref(false);
const processError = ref('');

// 工艺参数列由后端参数清单驱动（process_data 新增字段后自动出现在表格中）
const processParams = ref([]);
// 基础列合计 786px（序号/设备/产品/批次/工件编号/采集时间/状态），参数列每列 110px
const processTableWidth = computed(() => 786 + processParams.value.length * 110);

const processPaginationInfo = computed(() => {
  const total = processResult.value.total || 0;
  if (!total) return '共 0 条记录';
  const start = (processPage.value - 1) * processPageSize.value + 1;
  const end = Math.min(processPage.value * processPageSize.value, total);
  return `显示 <b>${start}-${end}</b> 条 / 共 <b>${total}</b> 条`;
});

function processStatusHtml(s) {
  const map = {
    normal: ['running', '&#9989;', '正常'],
    warning: ['warning', '&#9888;', '预警'],
    unqualified: ['error', '&#10060;', '不合格'],
  };
  const [cls, icon, text] = map[s] || ['running', '&#9989;', s ? escapeHtml(s) : '--'];
  return `<span class="status-badge ${cls}" style="padding:2px 10px;margin:0;width:auto;"><span class="status-icon ${cls}"></span>${text}</span>`;
}

async function loadProcessFilters() {
  try {
    const data = await apiGet('/api/process/filters');
    processFilters.value.devices = data.devices || [];
    processFilters.value.deviceList = data.deviceList || [];
    processFilters.value.products = data.products || [];
  } catch (e) {
    console.error('加载工艺筛选条件失败', e);
  }
}

// 工艺参数清单（决定表格参数列，process_data 新增字段后自动同步）
async function loadProcessParams() {
  try {
    const list = await apiGet('/api/process/params');
    if (Array.isArray(list) && list.length) processParams.value = list;
  } catch (e) {
    console.error('加载工艺参数清单失败', e);
  }
}

// 设备编号 → 设备名称（统一取自设备管理表）
function deviceName(code) {
  const hit = processFilters.value.deviceList.find((d) => d.device_code === code);
  return hit ? hit.device_name : '';
}

async function searchProcessData() {
  processLoading.value = true;
  processError.value = '';
  try {
    const params = new URLSearchParams();
    params.set('page', processPage.value);
    params.set('pageSize', processPageSize.value);
    if (processFilter.value.device) params.set('device', processFilter.value.device);
    if (processFilter.value.product) params.set('product', processFilter.value.product);
    if (processFilter.value.batch) params.set('batch', processFilter.value.batch);
    if (processFilter.value.startTime) params.set('startTime', processFilter.value.startTime);
    if (processFilter.value.endTime) params.set('endTime', processFilter.value.endTime);
    if (processFilter.value.status) params.set('status', processFilter.value.status);
    const data = await apiGet(`/api/process/data?${params.toString()}`);
    processResult.value = data;
    processTotalPages.value = data.totalPages || Math.max(1, Math.ceil((data.total || 0) / processPageSize.value));
    processPages.value = buildPageList(processTotalPages.value, processPage.value);
  } catch (e) {
    console.error('查询工艺数据失败', e);
    processError.value = `加载失败：${e.message}（请检查服务是否正常）`;
    processResult.value = { total: 0, page: 1, pageSize: processPageSize.value, data: [] };
  } finally {
    processLoading.value = false;
  }
}

function resetProcessFilter() {
  processFilter.value = { device: '', product: '', batch: '', startTime: '', endTime: '', status: '' };
  processPage.value = 1;
  searchProcessData();
}

function goProcessPage(p) {
  if (p === '...' || p === processPage.value) return;
  if (p < 1 || p > processTotalPages.value) return;
  processPage.value = p;
  searchProcessData();
}

// 切换每页条数后回到第一页重新查询
function changeProcessPageSize() {
  processPage.value = 1;
  searchProcessData();
}

// 导出当前查询条件下的数据；未设置时间范围时后端默认导出最近一个月
function exportProcessData() {
  const params = new URLSearchParams();
  if (processFilter.value.device) params.set('device', processFilter.value.device);
  if (processFilter.value.product) params.set('product', processFilter.value.product);
  if (processFilter.value.batch) params.set('batch', processFilter.value.batch);
  if (processFilter.value.startTime) params.set('startTime', processFilter.value.startTime);
  if (processFilter.value.endTime) params.set('endTime', processFilter.value.endTime);
  if (processFilter.value.status) params.set('status', processFilter.value.status);
  window.location.href = `/api/process/export?${params.toString()}`;
}

watch(
  () => props.active,
  (val) => {
    if (val) {
      loadProcessFilters();
      loadProcessParams();
      searchProcessData();
    }
  }
);

const STATE_KEY = 'process';
const savedState = loadPageState(STATE_KEY);
if (savedState) {
  processFilter.value = { ...processFilter.value, ...(savedState.filter || {}) };
  processPage.value = savedState.page || 1;
  processPageSize.value = savedState.pageSize || 10;
}

// 查询条件 / 页码变化时记忆，F5 或重新进入页面可恢复
watch(
  [processFilter, processPage, processPageSize],
  () => {
    savePageState(STATE_KEY, {
      filter: processFilter.value,
      page: processPage.value,
      pageSize: processPageSize.value,
    });
  },
  { deep: true }
);

onMounted(() => {
  if (props.active) {
    loadProcessFilters();
    loadProcessParams();
    searchProcessData();
  }
});
</script>

<style scoped>
/* 固定列宽：总宽 = 基础列 786px + 参数列(每列 110px)，由内联 style 动态计算，超出容器由横向进度条查看 */
.process-table {
  table-layout: fixed;
}

.process-table th,
.process-table td {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.process-table thead th,
.process-table tbody td {
  padding-left: 8px;
  padding-right: 8px;
}

.device-sub {
  display: block;
  font-size: 11px;
  color: var(--text-secondary);
}
</style>
