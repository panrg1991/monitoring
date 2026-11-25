<template>
  <div class="rec-overlay" v-if="visible" @click.self="close">
    <div class="rec-dialog">
      <div class="rec-header">
        <div>
          <h3>计划关联工艺数据</h3>
          <div class="rec-sub">
            <span>{{ planInfo.plan_code || '--' }}</span>
            <span v-if="planInfo.plan_name"> · {{ planInfo.plan_name }}</span>
            <span> · {{ planInfo.device_code || '--' }}</span>
            <span> · {{ planInfo.product_model || '全部产品' }}</span>
            <span> · {{ planInfo.start_time || '--' }} ~ {{ planInfo.end_time || '--' }}</span>
          </div>
        </div>
        <button class="rec-close" @click="close">&times;</button>
      </div>

      <div class="rec-summary">
        <span>计划数 <b>{{ planInfo.plan_count || 0 }}</b></span>
        <span>累计完成 <b>{{ planInfo.actual_count || 0 }}</b></span>
        <span>完成率 <b>{{ planInfo.rate_percent || 0 }}%</b></span>
        <span>关联记录 <b>{{ total }}</b> 条</span>
        <span class="rec-tip">统计口径：设备 + 计划周期 ∩ 执行段 + 产品</span>
      </div>

      <div class="rec-body">
        <div v-if="loading" class="rec-hint">数据加载中…</div>
        <div v-else-if="error" class="rec-error">{{ error }}</div>
        <template v-else>
          <div class="rec-scroll">
            <table class="rec-table">
              <colgroup>
                <col style="width:56px" />
                <col style="width:152px" />
                <col style="width:120px" />
                <col style="width:120px" />
                <col style="width:150px" />
                <col style="width:86px" />
                <col v-for="p in params" :key="'c-' + p.param_key" style="width:104px" />
              </colgroup>
              <thead>
                <tr>
                  <th>序号</th>
                  <th>采集时间</th>
                  <th>产品型号</th>
                  <th>批次</th>
                  <th>工件编号</th>
                  <th>状态</th>
                  <th v-for="p in params" :key="p.param_key" :title="p.param_name">{{ p.param_name }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(row, idx) in rows" :key="row.id">
                  <td>{{ (page - 1) * pageSize + idx + 1 }}</td>
                  <td class="rec-time">{{ row.collect_time }}</td>
                  <td>{{ row.product_model || '--' }}</td>
                  <td>{{ row.batch_no || '--' }}</td>
                  <td>{{ row.workpiece_no || '--' }}</td>
                  <td>
                    <span class="rec-status" :class="statusClass(row)">{{ statusText(row) }}</span>
                  </td>
                  <td v-for="p in params" :key="p.param_key">{{ display(row[p.param_key]) }}</td>
                </tr>
                <tr v-if="!rows.length">
                  <td :colspan="6 + params.length" class="rec-empty">
                    该计划暂无关联工艺数据（未开始执行，或执行时段内该设备无产出）
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div class="rec-pager">
            <span>共 <b>{{ total }}</b> 条 · 第 {{ page }} / {{ totalPages }} 页</span>
            <div class="rec-pager-btns">
              <button :disabled="page <= 1" @click="go(page - 1)">上一页</button>
              <button :disabled="page >= totalPages" @click="go(page + 1)">下一页</button>
            </div>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue';
import { apiGet } from '../api';

const props = defineProps({
  visible: { type: Boolean, default: false },
  plan: { type: Object, default: null },
});

const emit = defineEmits(['close']);

const rows = ref([]);
const params = ref([]);
const total = ref(0);
const page = ref(1);
const pageSize = ref(20);
const totalPages = ref(1);
const loading = ref(false);
const error = ref('');
const planInfo = ref({});

const planId = computed(() => (props.plan && props.plan.id) || 0);

function display(value) {
  if (value === null || value === undefined || value === '') return '--';
  return value;
}

function statusText(row) {
  const s = String(row.data_status || '');
  if (s === 'normal') return '合格';
  if (s === 'warning') return '预警';
  return '不合格';
}

function statusClass(row) {
  const s = String(row.data_status || '');
  if (s === 'normal') return 'ok';
  if (s === 'warning') return 'warn';
  return 'ng';
}

async function load(targetPage = page.value) {
  if (!planId.value) return;
  loading.value = true;
  error.value = '';
  try {
    const data = await apiGet(
      `/api/plans/records?id=${planId.value}&page=${targetPage}&pageSize=${pageSize.value}`
    );
    rows.value = data.data || [];
    params.value = data.params || [];
    total.value = data.total || 0;
    page.value = data.page || 1;
    totalPages.value = data.totalPages || 1;
    planInfo.value = data.plan || {};
  } catch (e) {
    error.value = e.message || '加载失败';
    rows.value = [];
    total.value = 0;
  } finally {
    loading.value = false;
  }
}

function go(target) {
  if (target < 1 || target > totalPages.value || target === page.value) return;
  load(target);
}

function close() {
  emit('close');
}

watch(
  () => props.visible,
  (val) => {
    if (!val) return;
    planInfo.value = props.plan ? { ...props.plan } : {};
    rows.value = [];
    params.value = [];
    total.value = 0;
    page.value = 1;
    totalPages.value = 1;
    load(1);
  }
);
</script>

<style scoped>
.rec-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.62);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9997;
  padding: 20px;
}

.rec-dialog {
  width: 1080px;
  max-width: 96vw;
  max-height: 88vh;
  display: flex;
  flex-direction: column;
  background: #16202e;
  border: 1px solid #2a3a52;
  border-radius: 12px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.55);
}

.rec-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 18px;
  border-bottom: 1px solid #24344a;
}

.rec-header h3 {
  margin: 0 0 6px;
  font-size: 16px;
  color: #e6edf5;
}

.rec-sub {
  font-size: 12px;
  color: #8ba3c7;
  line-height: 1.6;
}

.rec-close {
  background: none;
  border: none;
  color: #8ba3c7;
  font-size: 24px;
  line-height: 1;
  cursor: pointer;
}

.rec-close:hover { color: #e6edf5; }

.rec-summary {
  display: flex;
  align-items: center;
  gap: 18px;
  padding: 8px 18px;
  font-size: 12px;
  color: #8ba3c7;
  border-bottom: 1px solid #1f2c3d;
  flex-wrap: wrap;
}

.rec-summary b {
  color: #6ea8ff;
  font-size: 13px;
  margin-left: 2px;
}

.rec-tip {
  margin-left: auto;
  color: #6a7b91;
}

.rec-body {
  padding: 10px 14px 14px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.rec-hint,
.rec-error {
  padding: 28px 0;
  text-align: center;
  font-size: 13px;
  color: #8ba3c7;
}

.rec-error { color: #ff787e; }

.rec-scroll {
  flex: 1;
  min-height: 0;
  overflow: auto;
  border: 1px solid #24344a;
  border-radius: 8px;
}

.rec-scroll::-webkit-scrollbar { height: 8px; width: 8px; }
.rec-scroll::-webkit-scrollbar-thumb { background: #2f445e; border-radius: 4px; }
.rec-scroll::-webkit-scrollbar-track { background: #101a26; }

.rec-table {
  border-collapse: collapse;
  table-layout: fixed;
  min-width: 100%;
  width: max-content;
  font-size: 12px;
}

.rec-table th,
.rec-table td {
  padding: 7px 10px;
  border-bottom: 1px solid #1f2c3d;
  color: #c8d6e8;
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.rec-table th {
  position: sticky;
  top: 0;
  background: #1a2637;
  color: #9fb6d2;
  font-weight: 500;
  z-index: 1;
}

.rec-table tbody tr:hover { background: rgba(59, 130, 246, 0.06); }

.rec-time { color: #9fb6d2; }

.rec-status {
  display: inline-block;
  padding: 1px 8px;
  border-radius: 10px;
  font-size: 11px;
}

.rec-status.ok { background: rgba(82, 196, 26, 0.15); color: #52c41a; }
.rec-status.warn { background: rgba(250, 173, 20, 0.15); color: #faad14; }
.rec-status.ng { background: rgba(255, 77, 79, 0.15); color: #ff787e; }

.rec-empty {
  padding: 30px 0 !important;
  color: #6a7b91 !important;
}

.rec-pager {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-top: 10px;
  font-size: 12px;
  color: #8ba3c7;
}

.rec-pager b { color: #6ea8ff; }

.rec-pager-btns {
  display: flex;
  gap: 8px;
}

.rec-pager-btns button {
  padding: 4px 12px;
  border: 1px solid #2a3a52;
  border-radius: 6px;
  background: #1d2b3e;
  color: #c8d6e8;
  font-size: 12px;
  cursor: pointer;
}

.rec-pager-btns button:hover:not(:disabled) { border-color: #3b82f6; }
.rec-pager-btns button:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
