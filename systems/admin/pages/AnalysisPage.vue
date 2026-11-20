<template>
  <section class="page analysis">
    <div class="dashboard-header">
      <h1 class="dashboard-title">历史工件分析</h1>
      <div class="header-actions">
        <span class="data-source-tag">数据来源：工艺数据表 process_data</span>
        <button class="refresh-btn" @click="openStandardDialog">标准管理</button>
      </div>
    </div>

    <div class="analysis-container">
      <div class="analysis-layout">
        <div class="standard-panel">
          <div class="standard-header">
            <h3>分析标准</h3>
            <span class="badge-standard" :class="{ inactive: viewVersionId && String(viewVersionId) !== String(currentVersionId) }">
              {{ viewVersionLabel }}
            </span>
          </div>

          <div class="version-picker">
            <select v-model="viewVersionId">
              <option v-for="v in versionOptions" :key="v.id" :value="v.id">
                {{ v.version_name }}（{{ v.version_code }}）
              </option>
            </select>
            <div class="version-meta" v-if="viewVersion">
              <div>生效区间：{{ rangeText(viewVersion) }}</div>
              <div>适用产品：{{ viewVersion.product_model || '全部产品通用' }}</div>
              <div class="version-state" :class="versionState(viewVersion)">{{ versionStateText(viewVersion) }}</div>
            </div>
          </div>

          <div class="standard-body">
            <div v-for="s in viewStandards" :key="s.id" class="standard-item">
              <span class="std-label">{{ s.param_name }}</span>
              <div style="text-align:right;">
                <div class="std-value">{{ s.standard_value }} <span style="font-size:11px;color:var(--text-secondary);">{{ s.unit }}</span></div>
                <div class="std-range">&#177;{{ s.tolerance }}</div>
              </div>
            </div>
            <div v-if="!viewStandards.length" class="alarm-log-empty">该版本暂无标准参数</div>
          </div>
          <div class="standard-footer">
            判定规则：偏差 ≤ 容差为合格，≤ 2 倍容差为预警，超出为不合格
          </div>
        </div>

        <div class="compare-panel">
          <div class="compare-header">
            <h3>对比分析</h3>
            <div class="compare-filters">
              <input v-model="analysisFilter.keyword" placeholder="工件编号 / 批次 / 设备" @keyup.enter="searchCompareData" />
              <select v-model="analysisFilter.device" class="filter-select">
                <option value="">全部设备</option>
                <option v-for="d in analysisDeviceList" :key="d.device_code" :value="d.device_code">
                  {{ d.device_code }} {{ d.device_name }}
                </option>
              </select>
              <select v-model="analysisFilter.product" class="filter-select">
                <option value="">全部产品</option>
                <option v-for="p in analysisProductList" :key="p" :value="p">{{ p }}</option>
              </select>
              <input v-model="analysisFilter.startTime" type="datetime-local" title="开始时间" />
              <input v-model="analysisFilter.endTime" type="datetime-local" title="结束时间" />
              <button class="btn-search" style="height:32px;padding:0 16px;" @click="searchCompareData">查询</button>
              <button class="btn-reset" style="height:32px;padding:0 14px;" @click="resetFilter">重置</button>
            </div>
          </div>

          <div v-if="analysisLoading" class="page-hint">数据加载中…</div>
          <div v-else-if="analysisError" class="page-hint error">{{ analysisError }}</div>

          <HScrollBar :target="analysisScrollEl" />

          <div ref="analysisScrollEl" class="table-scroll no-native-scrollbar compare-table-wrap">
            <table class="compare-table" :style="{ width: compareTableWidth + 'px' }">
              <!-- 固定列宽：参数列随参数数量动态增加，超出容器由横向进度条查看 -->
              <colgroup>
                <col style="width:56px" />
                <col style="width:170px" />
                <col style="width:120px" />
                <col style="width:130px" />
                <col style="width:100px" />
                <col style="width:150px" />
                <col style="width:120px" />
                <col v-for="p in tableParams" :key="'col-' + p.param_key" style="width:120px" />
                <col style="width:110px" />
              </colgroup>
              <thead>
                <tr>
                  <th class="idx-col">序号</th>
                  <th>工件编号</th>
                  <th>批次</th>
                  <th>设备</th>
                  <th>产品</th>
                  <th>采集时间</th>
                  <th>判定标准</th>
                  <th v-for="p in tableParams" :key="p.param_key">{{ p.param_name }}</th>
                  <th class="judge-col">判定</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(row, idx) in analysisResult.data" :key="row.id">
                  <td class="idx-col">
                    {{ ((analysisResult.page || analysisPage) - 1) * (analysisResult.pageSize || analysisPageSize) + idx + 1 }}
                  </td>
                  <td>{{ row.workpiece_no || '--' }}</td>
                  <td>{{ row.batch_no || '--' }}</td>
                  <td>
                    {{ row.device_code }}
                    <span class="device-sub">{{ deviceName(row.device_code) }}</span>
                  </td>
                  <td>{{ row.product_model }}</td>
                  <td>{{ row.collect_time }}</td>
                  <td>
                    <span class="version-tag" :title="row.standard_version_code || ''">{{ row.standard_version_name }}</span>
                  </td>
                  <td v-for="p in tableParams" :key="p.param_key" v-html="analysisCellHtml(row, p.param_key)"></td>
                  <td class="judge-col" v-html="analysisJudgeHtml(row.judge_result, row.judge_detail)"></td>
                </tr>
                <tr v-if="!analysisResult.data || !analysisResult.data.length">
                  <td :colspan="tableParams.length + 8" style="text-align:center;color:var(--text-secondary);padding:30px 0;">暂无数据</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div class="legend-bar">
            <span class="legend-item"><i class="legend-dot ok"></i>合格</span>
            <span class="legend-item"><i class="legend-dot warn"></i>预警</span>
            <span class="legend-item"><i class="legend-dot err"></i>不合格</span>
            <span class="legend-item"><i class="legend-dot none"></i>未匹配标准</span>
            <span class="legend-item legend-note">每条记录按其采集时间自动匹配当时生效的标准版本</span>
          </div>

          <div class="pagination">
            <span class="pagination-info">
              合格率：<b style="color:#52c41a;">{{ analysisResult.qualifiedRate || '0.0' }}%</b>
              <span style="margin:0 10px;color:var(--border-color);">|</span>
              不合格率：<b style="color:#ff4d4f;">{{ analysisResult.unqualifiedRate }}%</b>
              <span style="margin:0 10px;color:var(--border-color);">|</span>
              <span v-html="analysisPaginationInfo"></span>
            </span>
            <div class="pagination-btns">
              <button class="page-btn" :disabled="analysisPage <= 1" @click="goAnalysisPage(analysisPage - 1)">上一页</button>
              <button
                v-for="p in analysisPages"
                :key="p"
                class="page-btn"
                :class="{ active: p === analysisPage }"
                @click="goAnalysisPage(p)"
              >{{ p }}</button>
              <button class="page-btn" :disabled="analysisPage >= analysisTotalPages" @click="goAnalysisPage(analysisPage + 1)">下一页</button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <AnalysisStandardDialog
      :visible="standardDialogVisible"
      :versions="versions"
      :params="paramOptions"
      :current-version-id="currentVersionId"
      @close="standardDialogVisible = false"
      @saved="refreshStandards"
    />
  </section>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue';
import { apiGet, buildPageList, escapeHtml } from '../../shared/api';
import HScrollBar from '../../shared/HScrollBar.vue';
import AnalysisStandardDialog from './AnalysisStandardDialog.vue';

const props = defineProps({
  active: { type: Boolean, default: false },
});

const versions = ref([]);
const paramOptions = ref([]);
const currentVersionId = ref(null);
const viewVersionId = ref('');
const standardDialogVisible = ref(false);

const analysisFilter = ref({ keyword: '', device: '', product: '', startTime: '', endTime: '' });
const analysisResult = ref({
  total: 0, page: 1, pageSize: 10, data: [],
  unqualifiedRate: '0.0', qualifiedRate: '0.0', params: [],
});
const analysisDeviceList = ref([]);
const analysisProductList = ref([]);
const analysisPage = ref(1);
const analysisPageSize = ref(10);
const analysisTotalPages = ref(1);
const analysisPages = ref([]);
const analysisLoading = ref(false);
const analysisError = ref('');

const viewVersion = computed(
  () => versions.value.find((v) => String(v.id) === String(viewVersionId.value)) || null
);

const viewVersionLabel = computed(() => {
  if (!viewVersion.value) return '标准库';
  return viewVersion.value.version_name;
});

const viewStandards = computed(() => (viewVersion.value && viewVersion.value.standards) || []);

const versionOptions = computed(() => versions.value);

// 表格参数列：优先使用后端返回的参数并集，无数据时回退到当前查看版本
const tableParams = computed(() => {
  const list = analysisResult.value.params;
  if (list && list.length) return list;
  return viewStandards.value.map((s) => ({
    param_key: s.param_key,
    param_name: s.param_name,
    unit: s.unit,
  }));
});

// 表格总宽 = 固定列（996px）+ 参数列（每列 120px）
const analysisScrollEl = ref(null);
const compareTableWidth = computed(() => 996 + tableParams.value.length * 120);

const analysisPaginationInfo = computed(() => {
  const total = analysisResult.value.total || 0;
  if (!total) return '共 0 条记录';
  const start = (analysisPage.value - 1) * analysisPageSize.value + 1;
  const end = Math.min(analysisPage.value * analysisPageSize.value, total);
  return `显示 <b>${start}-${end}</b> 条 / 共 <b>${total}</b> 条`;
});

function rangeText(v) {
  const from = (v.effective_from || '').slice(0, 16);
  const to = v.effective_to ? (v.effective_to || '').slice(0, 16) : '至今';
  return `${from} ~ ${to}`;
}

function versionState(v) {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const nowText = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  if (Number(v.is_active) === 0) return 'off';
  if (v.effective_from > nowText) return 'future';
  if (v.effective_to && v.effective_to < nowText) return 'expired';
  return 'active';
}

function versionStateText(v) {
  const state = versionState(v);
  if (state === 'future') return '未生效';
  if (state === 'expired') return '已失效';
  if (state === 'off') return '已停用';
  return '当前生效';
}

// 设备编号 → 设备名称（统一取自设备管理表）
function deviceName(code) {
  const hit = analysisDeviceList.value.find((d) => d.device_code === code);
  return hit ? hit.device_name : '';
}

function toStandardMap(standards) {
  const map = {};
  (standards || []).forEach((s) => { map[s.param_key] = s; });
  return map;
}

// 单元格渲染：使用该行记录自身匹配到的标准版本
function analysisCellHtml(row, key) {
  const value = row[key];
  if (value == null || value === '') return '<span class="cell-in-range">--</span>';
  const std = row._stdMap ? row._stdMap[key] : null;
  if (!std) return `<span class="cell-in-range">${value}</span>`;

  const stdValue = Number(std.standard_value);
  const tol = Math.abs(Number(std.tolerance) || 0);
  const diff = Number(value) - stdValue;
  const abs = Math.abs(diff);
  let cls = 'cell-in-range';
  if (abs > tol) cls = abs <= tol * 2 ? 'cell-warning' : 'cell-out-of-range';

  let diffHtml = '';
  if (abs > tol) {
    const pct = stdValue ? ((abs / stdValue) * 100).toFixed(1) : '0';
    diffHtml = `<span class="diff-value">${diff > 0 ? '+' : ''}${diff.toFixed(2)} (${pct}%)</span>`;
  }
  return `<span class="${cls}">${value}</span>${diffHtml}`;
}

function analysisJudgeHtml(judge, detail) {
  const map = {
    qualified: ['running', '合格'],
    warning: ['warning', '预警'],
    unqualified: ['error', '不合格'],
    no_standard: ['offline', '无标准'],
  };
  const [cls, text] = map[judge] || ['running', judge ? escapeHtml(judge) : '--'];
  // 判定标签只保留文字（去掉前置圆点），单行展示不换行
  const badgeStyle = 'display:inline-flex;align-items:center;justify-content:center;width:auto;max-width:none;margin:0 auto;padding:3px 12px;font-size:12px;line-height:1.4;white-space:nowrap;word-break:keep-all;flex:0 0 auto;';
  return `<span class="status-badge ${cls}" style="${badgeStyle}" title="${escapeHtml(detail)}">`
    + `<span class="judge-text" style="white-space:nowrap;">${text}</span></span>`;
}

function applyRowStandards(rows, standardsByVersion) {
  (rows || []).forEach((row) => {
    const list = (standardsByVersion && standardsByVersion[row.standard_version_id]) || row.standards || [];
    row._stdMap = toStandardMap(list);
  });
  return rows;
}

async function loadAnalysisData() {
  try {
    const [versionData, filters] = await Promise.all([
      apiGet('/api/analysis/versions'),
      apiGet('/api/analysis/filters'),
    ]);
    versions.value = (versionData && versionData.versions) || [];
    paramOptions.value = (versionData && versionData.params) || [];
    currentVersionId.value = versionData ? versionData.currentVersionId : null;
    if (!viewVersionId.value || !versions.value.some((v) => String(v.id) === String(viewVersionId.value))) {
      viewVersionId.value = currentVersionId.value || (versions.value[0] && versions.value[0].id) || '';
    }
    analysisDeviceList.value = (filters && filters.deviceList) || [];
    analysisProductList.value = (filters && filters.products) || [];
    searchCompareData();
  } catch (e) {
    console.error('加载分析数据失败', e);
  }
}

// 标准变更后仅刷新标准库，保持当前查询条件不变
async function refreshStandards() {
  try {
    const versionData = await apiGet('/api/analysis/versions');
    versions.value = (versionData && versionData.versions) || [];
    paramOptions.value = (versionData && versionData.params) || [];
    currentVersionId.value = versionData ? versionData.currentVersionId : null;
    if (!versions.value.some((v) => String(v.id) === String(viewVersionId.value))) {
      viewVersionId.value = currentVersionId.value || (versions.value[0] && versions.value[0].id) || '';
    }
    searchCompareData();
  } catch (e) {
    console.error('刷新标准失败', e);
  }
}

async function searchCompareData() {
  analysisLoading.value = true;
  analysisError.value = '';
  try {
    const params = new URLSearchParams();
    params.set('page', analysisPage.value);
    params.set('pageSize', analysisPageSize.value);
    if (analysisFilter.value.keyword) params.set('keyword', analysisFilter.value.keyword);
    if (analysisFilter.value.device) params.set('device', analysisFilter.value.device);
    if (analysisFilter.value.product) params.set('product', analysisFilter.value.product);
    if (analysisFilter.value.startTime) params.set('startTime', analysisFilter.value.startTime.replace('T', ' '));
    if (analysisFilter.value.endTime) params.set('endTime', analysisFilter.value.endTime.replace('T', ' '));
    const data = await apiGet(`/api/analysis/data?${params.toString()}`);
    data.data = applyRowStandards(data.data, data.standardsByVersion);
    analysisResult.value = data;
    analysisTotalPages.value = data.totalPages || Math.max(1, Math.ceil((data.total || 0) / analysisPageSize.value));
    analysisPages.value = buildPageList(analysisTotalPages.value, analysisPage.value);
  } catch (e) {
    console.error('对比查询失败', e);
    analysisError.value = `加载失败：${e.message}（请检查服务是否正常）`;
    analysisResult.value = { ...analysisResult.value, data: [], total: 0 };
  } finally {
    analysisLoading.value = false;
  }
}

function resetFilter() {
  analysisFilter.value = { keyword: '', device: '', product: '', startTime: '', endTime: '' };
  analysisPage.value = 1;
  searchCompareData();
}

function openStandardDialog() {
  standardDialogVisible.value = true;
}

function goAnalysisPage(p) {
  if (p === '...' || p === analysisPage.value) return;
  if (p < 1 || p > analysisTotalPages.value) return;
  analysisPage.value = p;
  searchCompareData();
}

watch(
  () => props.active,
  (val) => {
    if (val) loadAnalysisData();
  }
);

onMounted(() => {
  if (props.active) loadAnalysisData();
});
</script>

<style scoped>
.header-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.data-source-tag {
  font-size: 12px;
  color: var(--text-secondary);
  background: rgba(24, 144, 255, 0.1);
  border: 1px solid rgba(24, 144, 255, 0.3);
  border-radius: 12px;
  padding: 4px 12px;
}

.badge-standard.inactive {
  background: linear-gradient(135deg, #6b7f99, #8ba3c7);
}

.version-picker {
  padding: 12px 20px 4px;
  border-bottom: 1px solid var(--border-color);
}

.version-picker select {
  width: 100%;
  background-color: #0f1c30;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  padding: 6px 10px;
  color: var(--text-primary);
  font-size: 12px;
  outline: none;
  color-scheme: dark;
}

.version-meta {
  margin-top: 8px;
  font-size: 11px;
  color: var(--text-secondary);
  line-height: 1.7;
}

.version-state {
  display: inline-block;
  margin-top: 4px;
  padding: 1px 8px;
  border-radius: 10px;
  font-size: 11px;
}

.version-state.active { background: rgba(82, 196, 26, 0.15); color: #52c41a; }
.version-state.expired { background: rgba(140, 155, 175, 0.15); color: #8ba3c7; }
.version-state.future { background: rgba(24, 144, 255, 0.15); color: #40a9ff; }
.version-state.off { background: rgba(255, 77, 79, 0.12); color: #ff787e; }

.standard-footer {
  padding: 12px 20px;
  border-top: 1px solid var(--border-color);
  font-size: 11px;
  line-height: 1.6;
  color: var(--text-secondary);
}

.filter-select {
  background-color: #0f1c30;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  padding: 6px 12px;
  color: var(--text-primary);
  font-size: 12px;
  outline: none;
  color-scheme: dark;
  cursor: pointer;
}

.filter-select option {
  background-color: #0f1c30;
  color: var(--text-primary);
}

.version-tag {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 10px;
  background: rgba(24, 144, 255, 0.12);
  color: #40a9ff;
  white-space: nowrap;
}

.device-sub {
  display: block;
  font-size: 11px;
  color: var(--text-secondary);
}

.legend-dot.none { background: rgba(140, 155, 175, 0.2); border: 1px solid #8ba3c7; }

.legend-note {
  margin-left: auto;
  font-size: 11px;
  color: var(--text-secondary);
}
</style>
