<template>
  <section class="page recipe">
    <div class="dashboard-header">
      <h1 class="dashboard-title">{{ isAdmin ? '模具配方管理' : '模具配方' }}</h1>
      <div class="header-actions">
        <button v-if="isAdmin && can('recipe', 'create')" class="refresh-btn" @click="openCreate">+ 新增配方</button>
      </div>
    </div>

    <div class="tech-data-container">
      <div class="filter-bar">
        <div class="filter-group">
          <label>产品</label>
          <select v-model="filter.product_id" @change="search">
            <option value="">全部产品</option>
            <option v-for="p in options.products" :key="p.id" :value="String(p.id)">
              {{ p.product_name }}{{ p.product_code ? `（${p.product_code}）` : '' }}
            </option>
          </select>
        </div>
        <div class="filter-group">
          <label>模具</label>
          <select v-model="filter.mold_id" @change="search">
            <option value="">全部模具</option>
            <option v-for="m in options.molds" :key="m.id" :value="String(m.id)">
              {{ m.mold_name }}{{ m.mold_code ? `（${m.mold_code}）` : '' }}
            </option>
          </select>
        </div>
        <div class="filter-group">
          <label>生产线</label>
          <select v-model="filter.line" @change="search">
            <option value="">全部产线</option>
            <option v-for="l in options.lines" :key="l" :value="l">{{ l }}</option>
          </select>
        </div>
        <button class="btn-search" @click="search">搜索</button>
        <button class="btn-reset" @click="resetFilter">重置</button>
        <button class="btn-export" title="按当前筛选条件导出全部配方" @click="exportRecipes">导出</button>
      </div>

      <div v-if="loading" class="page-hint">数据加载中…</div>

      <div class="data-table-wrapper">
        <div class="data-toolbar">
          <span>共 <b>{{ total }}</b> 条配方</span>
          <span v-if="message" class="recipe-message">{{ message }}</span>
          <span v-html="paginationInfo"></span>
        </div>

        <!-- 横向进度条：列宽固定后总宽超出容器时出现，可拖动查看后面的参数 -->
        <HScrollBar :target="tableScrollEl" />

        <div ref="tableScrollEl" class="table-scroll no-native-scrollbar">
          <table class="data-table recipe-table">
            <!-- 每列固定宽度：参数继续增加时总宽随之增大，由外层容器横向滚动查看 -->
            <colgroup>
              <col style="width:56px" />
              <col style="width:160px" />
              <col style="width:110px" />
              <col style="width:110px" />
              <col style="width:80px" />
              <col style="width:66px" />
              <col style="width:84px" />
              <col style="width:76px" />
              <col style="width:66px" />
              <col style="width:84px" />
              <col style="width:76px" />
              <col style="width:66px" />
              <col style="width:84px" />
              <col style="width:92px" />
              <col style="width:88px" />
              <col style="width:84px" />
              <col style="width:84px" />
              <col style="width:84px" />
              <col style="width:84px" />
              <col style="width:84px" />
              <col style="width:84px" />
              <col style="width:84px" />
              <col style="width:170px" />
              <col style="width:150px" />
              <col style="width:116px" />
            </colgroup>
            <thead>
              <tr>
                <th class="idx-col">序号</th>
                <th>产品名称</th>
                <th>产品编码</th>
                <th>模具</th>
                <th>生产线</th>
                <th class="group-start">一快</th>
                <th class="num">一快位置<br />(mm)</th>
                <th class="num">一快阀位</th>
                <th class="group-start">二快</th>
                <th class="num">二快位置<br />(mm)</th>
                <th class="num">二快阀位</th>
                <th class="group-start">增压</th>
                <th class="num">增压位置<br />(mm)</th>
                <th class="num">增压压力<br />(MPa)</th>
                <th class="num group-start">跟踪终点<br />(mm)</th>
                <th class="num">快射储能</th>
                <th class="num">增压储能</th>
                <th class="num group-start">压射时间<br />(s)</th>
                <th class="num">增压延时<br />(s)</th>
                <th class="num">冷却时间<br />(s)</th>
                <th class="num">锤击延时<br />(s)</th>
                <th class="num">慢压流量</th>
                <th class="group-start">备注</th>
                <th class="group-start">更新时间</th>
                <th class="group-start" style="width:130px;">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(r, idx) in rows" :key="r.id">
                <td class="idx-col">{{ (page - 1) * pageSize + idx + 1 }}</td>
                <td class="product-cell" :title="r.product_name">{{ r.product_name }}</td>
                <td class="code-cell">{{ r.product_code || '--' }}</td>
                <td>{{ r.mold_name || '--' }}</td>
                <td>{{ r.production_line || '--' }}</td>
                <td class="group-start">
                  <span class="flag-tag" :class="flagOn(r.fast1_enabled) ? 'on' : 'off'">{{ flagText(r.fast1_enabled) }}</span>
                </td>
                <td class="num">{{ numText(r.fast1_position) }}</td>
                <td class="num">{{ numText(r.fast1_valve) }}</td>
                <td class="group-start">
                  <span class="flag-tag" :class="flagOn(r.fast2_enabled) ? 'on' : 'off'">{{ flagText(r.fast2_enabled) }}</span>
                </td>
                <td class="num">{{ numText(r.fast2_position) }}</td>
                <td class="num">{{ numText(r.fast2_valve) }}</td>
                <td class="group-start">
                  <span class="flag-tag" :class="flagOn(r.boost_enabled) ? 'on' : 'off'">{{ flagText(r.boost_enabled) }}</span>
                </td>
                <td class="num">{{ numText(r.boost_position) }}</td>
                <td class="num">{{ numText(r.boost_pressure) }}</td>
                <td class="num group-start">{{ numText(r.track_end_pos) }}</td>
                <td class="num">{{ numText(r.fast_energy_pressure) }}</td>
                <td class="num">{{ numText(r.boost_energy_pressure) }}</td>
                <td class="num group-start">{{ numText(r.injection_time) }}</td>
                <td class="num">{{ numText(r.boost_delay) }}</td>
                <td class="num">{{ numText(r.cooling_time) }}</td>
                <td class="num">{{ numText(r.hammer_delay) }}</td>
                <td class="num">{{ numText(r.slow_flow) }}</td>
                <td class="remark-cell group-start" :title="r.remark || ''">
                  <span>{{ r.remark || '--' }}</span>
                </td>
                <td class="time-cell group-start">{{ r.updated_at || r.created_at || '--' }}</td>
                <td class="group-start">
                  <template v-if="isAdmin && (can('recipe', 'update') || can('recipe', 'delete'))">
                    <button v-if="can('recipe', 'update')" class="link-btn" @click="openEdit(r)">编辑</button>
                    <button v-if="can('recipe', 'delete')" class="link-btn danger" @click="askDelete(r)">删除</button>
                  </template>
                  <span v-else class="sub-text">--</span>
                </td>
              </tr>
              <tr v-if="!rows.length && !loading">
                <td colspan="25" style="text-align:center;color:var(--text-secondary);padding:30px 0;">
                  {{ isAdmin
                    ? '暂无配方数据，点击「新增配方」创建；产品与模具均从档案下拉选择。'
                    : '暂无配方数据，请在管理后台「模具配方」中维护。' }}
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

    <template v-if="isAdmin">
      <RecipeEditDialog
        :visible="dialogVisible"
        :recipe="editingRecipe"
        :options="options"
        @close="dialogVisible = false"
        @saved="onSaved"
      />

      <AppDialog
        :visible="confirmState.visible"
        title="删除配方"
        :message="confirmState.message"
        mode="confirm"
        @confirm="handleConfirm"
        @cancel="confirmState.visible = false"
      />
    </template>
  </section>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue';
import { apiGet, apiPost, buildPageList } from '../api';
import { can } from '../auth';
import { loadPageState, savePageState } from '../usePageState';
import HScrollBar from '../HScrollBar.vue';
import RecipeEditDialog from './RecipeEditDialog.vue';
import AppDialog from '../AppDialog.vue';

const props = defineProps({
  active: { type: Boolean, default: false },
  // display = 车间看板（只读查看）；admin = 管理后台（可新增 / 编辑 / 删除）
  viewMode: { type: String, default: 'admin' },
});

const isAdmin = computed(() => props.viewMode !== 'display');

const emptyOptions = () => ({ products: [], molds: [], lines: [] });
const emptyFilter = () => ({ product_id: '', mold_id: '', line: '' });

const options = ref(emptyOptions());
const filter = ref(emptyFilter());
const rows = ref([]);
const total = ref(0);
const page = ref(1);
const pageSize = ref(10);
const totalPages = ref(1);
const pageList = ref([]);
const loading = ref(false);
const message = ref('');
const dialogVisible = ref(false);
const editingRecipe = ref(null);
const confirmState = ref({ visible: false, message: '', recipe: null });

const paginationInfo = computed(() => {
  if (!total.value) return '共 0 条';
  const start = (page.value - 1) * pageSize.value + 1;
  const end = Math.min(page.value * pageSize.value, total.value);
  return `显示 <b>${start}-${end}</b> 条 / 共 <b>${total.value}</b> 条`;
});

// 开关：快射组用「是 / 否」，增压组历史上用「1 / 0」
function flagOn(value) {
  return value === '是' || String(value) === '1';
}

function flagText(value) {
  return flagOn(value) ? '开' : '关';
}

function numText(value) {
  if (value === null || value === undefined || value === '') return '--';
  const num = Number(value);
  return Number.isFinite(num) ? String(Math.round(num * 100) / 100) : '--';
}

// 表格横向进度条由共用组件 HScrollBar 负责测量与拖动
const tableScrollEl = ref(null);

function flash(text) {
  message.value = text;
  setTimeout(() => {
    if (message.value === text) message.value = '';
  }, 4000);
}

async function loadOptions() {
  try {
    const data = await apiGet('/api/recipes/options');
    options.value = {
      products: data.products || [],
      molds: data.molds || [],
      lines: data.lines || [],
    };
  } catch (e) {
    console.error('加载配方下拉选项失败', e);
    options.value = emptyOptions();
  }
}

async function loadRecipes() {
  loading.value = true;
  try {
    const params = new URLSearchParams();
    if (filter.value.product_id) params.set('product_id', filter.value.product_id);
    if (filter.value.mold_id) params.set('mold_id', filter.value.mold_id);
    if (filter.value.line) params.set('line', filter.value.line);
    params.set('page', page.value);
    params.set('pageSize', pageSize.value);

    const data = await apiGet(`/api/recipes/list?${params.toString()}`);
    rows.value = data.data || [];
    total.value = data.total || 0;
    totalPages.value = data.totalPages || 1;
    pageList.value = buildPageList(totalPages.value, data.page || page.value);
    page.value = data.page || page.value;
  } catch (e) {
    rows.value = [];
    total.value = 0;
    totalPages.value = 1;
    pageList.value = [];
    flash(e.message || '加载配方失败');
  } finally {
    loading.value = false;
  }
}

function reload() {
  loadOptions();
  loadRecipes();
}

function search() {
  page.value = 1;
  loadRecipes();
}

function resetFilter() {
  filter.value = emptyFilter();
  page.value = 1;
  loadRecipes();
}

function goPage(p) {
  if (p === '...' || p === page.value) return;
  if (p < 1 || p > totalPages.value) return;
  page.value = p;
  loadRecipes();
}

function changePageSize() {
  page.value = 1;
  loadRecipes();
}

// 导出当前筛选条件下的全部配方
function exportRecipes() {
  const params = new URLSearchParams();
  if (filter.value.product_id) params.set('product_id', filter.value.product_id);
  if (filter.value.mold_id) params.set('mold_id', filter.value.mold_id);
  if (filter.value.line) params.set('line', filter.value.line);
  const query = params.toString();
  window.location.href = `/api/recipes/export${query ? '?' + query : ''}`;
}

function openCreate() {
  editingRecipe.value = null;
  dialogVisible.value = true;
}

function openEdit(recipe) {
  editingRecipe.value = recipe;
  dialogVisible.value = true;
}

function onSaved() {
  flash('配方已保存');
  reload();
}

function askDelete(recipe) {
  confirmState.value = {
    visible: true,
    recipe,
    message: `确定删除【${recipe.product_name}】在「${recipe.production_line || '未指定产线'}」的配方？删除后不可恢复。`,
  };
}

async function handleConfirm() {
  const recipe = confirmState.value.recipe;
  confirmState.value.visible = false;
  if (!recipe) return;
  try {
    await apiPost('/api/recipes/delete', { id: recipe.id });
    flash('配方已删除');
    // 删除后当前页可能已空，回退一页再查
    if (rows.value.length === 1 && page.value > 1) page.value -= 1;
    reload();
  } catch (e) {
    flash(e.message || '删除失败');
  }
}

const STATE_KEY = 'recipe';
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

watch(
  () => props.active,
  (val) => {
    if (val) reload();
  }
);

onMounted(() => {
  if (props.active) reload();
});
</script>

<style scoped>
.header-actions {
  display: flex;
  gap: 12px;
}

.recipe-message {
  color: #40a9ff;
  font-size: 12px;
}

.code-cell {
  font-family: 'Courier New', monospace;
  font-size: 12px;
  color: #40a9ff;
}

/* 全参数表格：每列固定宽度（见模板 colgroup），总宽 2322px 由列宽累加得出。
   参数继续增加时，把新列的宽度累加到该值即可，超出容器由 .table-scroll 横向滚动。 */
.recipe-table {
  table-layout: fixed;
  width: 2322px;
}

.recipe-table th,
.recipe-table td {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 列数较多，收窄左右内边距，让更多参数在一屏内可见 */
.recipe-table thead th,
.recipe-table tbody td {
  padding-left: 8px;
  padding-right: 8px;
}

.recipe-table th.num,
.recipe-table td.num {
  text-align: right;
}

.recipe-table td.num {
  font-variant-numeric: tabular-nums;
}

.recipe-table th.group-start,
.recipe-table td.group-start {
  border-left: 1px solid rgba(64, 169, 255, 0.22);
}

.recipe-table .remark-cell span {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.flag-tag {
  display: inline-block;
  min-width: 26px;
  padding: 1px 6px;
  border-radius: 8px;
  font-size: 12px;
  text-align: center;
}

.flag-tag.on {
  background: rgba(82, 196, 26, 0.15);
  color: #52c41a;
}

.flag-tag.off {
  background: rgba(140, 155, 175, 0.15);
  color: #8ba3c7;
}

.time-cell {
  font-size: 12px;
  color: var(--text-secondary);
  white-space: nowrap;
}

.sub-text {
  font-size: 12px;
  color: var(--text-secondary);
}

.link-btn {
  background: none;
  border: none;
  color: #40a9ff;
  font-size: 13px;
  cursor: pointer;
  padding: 2px 6px;
}

.link-btn:hover {
  text-decoration: underline;
}

.link-btn.danger {
  color: #ff787e;
}
</style>
