<template>
  <section class="page chart">
    <div class="dashboard-header">
      <h1 class="dashboard-title">工艺参数曲线</h1>
    </div>

    <div class="tech-data-container">
      <!-- 参数多选 -->
      <div class="filter-bar">
        <div class="filter-group param-select">
          <label>工艺参数（可多选，点击切换）</label>
          <div class="param-chips">
            <button
              v-for="p in paramList"
              :key="p.param_key"
              class="param-chip"
              :class="{ on: isSelected(p.param_key) }"
              :style="isSelected(p.param_key) ? { borderColor: colorOf(p.param_key), color: colorOf(p.param_key), background: hexToRgba(colorOf(p.param_key), 0.12) } : null"
              @click="toggleParam(p.param_key)"
            >
              {{ p.param_name }}<span v-if="p.unit" class="chip-unit">{{ p.unit }}</span>
            </button>
            <span v-if="!paramList.length" class="param-loading">参数加载中…</span>
          </div>
        </div>
      </div>

      <!-- 查询条件 -->
      <div class="filter-bar">
        <div class="filter-group">
          <label>数据范围</label>
          <select v-model.number="limit" :disabled="!!filters.startTime || !!filters.endTime">
            <option :value="50">最近 50 条</option>
            <option :value="100">最近 100 条</option>
            <option :value="200">最近 200 条</option>
          </select>
        </div>
        <div class="filter-group">
          <label>开始时间</label>
          <input v-model="filters.startTime" type="datetime-local" />
        </div>
        <div class="filter-group">
          <label>结束时间</label>
          <input v-model="filters.endTime" type="datetime-local" />
        </div>
        <div class="filter-group">
          <label>设备</label>
          <select v-model="filters.device">
            <option value="">全部设备</option>
            <option v-for="d in deviceList" :key="d.device_code" :value="d.device_code">
              {{ d.device_code }} {{ d.device_name }}
            </option>
          </select>
        </div>
        <div class="filter-group">
          <label>产品型号</label>
          <select v-model="filters.product">
            <option value="">全部产品</option>
            <option v-for="p in productList" :key="p" :value="p">{{ p }}</option>
          </select>
        </div>
        <button class="btn-search" :disabled="loading" @click="loadSeries">{{ loading ? '查询中…' : '查询' }}</button>
        <button class="btn-reset" @click="resetFilter">重置</button>
      </div>

      <!-- 图表 -->
      <div class="chart-card">
        <div class="chart-head">
          <div class="module-title">
            曲线图
            <span class="chart-sub">{{ chartSummary }}</span>
          </div>
          <div class="legend">
            <button
              v-for="s in series"
              :key="s.key"
              class="legend-item"
              :class="{ off: isHidden(s.key), axis: axisSeries && axisSeries.key === s.key }"
              :title="`${s.name}：${fmtNum(s.min)} ~ ${fmtNum(s.max)} ${s.unit}（点击切换纵轴，右侧 × 隐藏曲线）`"
              @click="toggleAxis(s.key)"
            >
              <i :style="{ background: s.color }"></i>
              <span>{{ s.name }}</span>
              <span class="legend-val">{{ fmtNum(s.lastVal) }} {{ s.unit }}</span>
              <span class="legend-hide" @click.stop="toggleHidden(s.key)">&#215;</span>
            </button>
          </div>
        </div>

        <div v-if="axisSeries" class="axis-note">
          纵轴：
          <b :style="{ color: axisSeries.color }">{{ axisSeries.name }}</b>
          <span v-if="axisSeries.unit">（{{ axisSeries.unit }}）</span>
          <span>刻度 {{ fmtNum(axisSeries.domainMin) }} ~ {{ fmtNum(axisSeries.domainMax) }}</span>
        </div>

        <div v-if="errorMsg" class="chart-empty">{{ errorMsg }}</div>
        <div v-else-if="!rows.length" class="chart-empty">暂无数据，请选择工艺参数并查询</div>
        <div v-else-if="!visibleSeries.length" class="chart-empty">所有曲线已隐藏，点击图例恢复显示</div>

        <div v-else class="chart-box">
          <svg class="chart-svg" :viewBox="`0 0 ${W} ${H}`" @mousemove="onMove" @mouseleave="hoverIndex = -1">
            <g class="grid">
              <line v-for="(t, i) in yTicks" :key="'gy' + i" :x1="PAD.l" :x2="W - PAD.r" :y1="t.y" :y2="t.y" />
              <line v-for="(t, i) in xTicks" :key="'gx' + i" :x1="t.x" :x2="t.x" :y1="PAD.t" :y2="H - PAD.b" />
            </g>

            <g class="axis">
              <text
                v-for="(t, i) in yTicks"
                :key="'ly' + i"
                :x="PAD.l - 10"
                :y="t.y + 4"
                text-anchor="end"
              >{{ t.label }}</text>
              <text
                v-for="(t, i) in xTicks"
                :key="'lx' + i"
                :x="t.x"
                :y="H - PAD.b + 20"
                text-anchor="middle"
              >{{ t.label }}</text>
            </g>

            <path
              v-for="s in visibleSeries"
              :key="s.key"
              :d="s.path"
              :stroke="s.color"
              fill="none"
              stroke-width="2"
              stroke-linejoin="round"
              stroke-linecap="round"
            />

            <g v-if="hover">
              <line
                :x1="hover.x" :x2="hover.x" :y1="PAD.t" :y2="H - PAD.b"
                stroke="rgba(255,255,255,0.35)" stroke-width="1" stroke-dasharray="4 3"
              />
              <circle
                v-for="d in hover.dots"
                :key="'hd' + d.key"
                :cx="hover.x" :cy="d.y" r="3.5"
                :fill="d.color" stroke="#0b1524" stroke-width="1.5"
              />
            </g>
          </svg>

          <div v-if="hover" class="chart-tip" :style="tipStyle">
            <div class="tip-time">{{ hover.time }}</div>
            <div v-for="item in hover.items" :key="item.key" class="tip-row">
              <i :style="{ background: item.color }"></i>
              <span>{{ item.name }}</span>
              <b>{{ item.value == null ? '--' : `${fmtNum(item.value)} ${item.unit}` }}</b>
            </div>
          </div>
        </div>

        <div class="chart-foot">
          <span>{{ chartModeText }}</span>
          <span v-if="rows.length">{{ rows.length }} 个数据点 · 显示 {{ visibleSeries.length }} / {{ series.length }} 条曲线</span>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue';
import { apiGet } from '../api';

const props = defineProps({
  active: { type: Boolean, default: false },
});

// 曲线调色板（深色主题下区分度较高的 8 色）
const PALETTE = ['#1890ff', '#52c41a', '#faad14', '#ff7a45', '#ff4d4f', '#13c2c2', '#a0d911', '#9254de'];

// SVG 画布尺寸与内边距
const W = 1000;
const H = 440;
const PAD = { l: 64, r: 24, t: 20, b: 44 };
const INNER_W = W - PAD.l - PAD.r;
const INNER_H = H - PAD.t - PAD.b;

const paramList = ref([]);       // [{param_key, param_name, unit}]
const selected = ref([]);        // 已选参数 key
const hiddenKeys = ref([]);      // 图例中被隐藏的曲线
const deviceList = ref([]);
const productList = ref([]);
const filters = ref({ device: '', product: '', startTime: '', endTime: '' });
const limit = ref(100);
const axisKey = ref('');         // 当前纵轴基准曲线（参数 key）
const rows = ref([]);            // 升序工艺记录
const loading = ref(false);
const errorMsg = ref('');
const chartMode = ref('limit');
const chartLimit = ref(100);
const hoverIndex = ref(-1);

const selectedMeta = computed(() =>
  selected.value
    .map((k) => paramList.value.find((p) => p.param_key === k))
    .filter(Boolean)
    .map((p) => ({ key: p.param_key, name: p.param_name, unit: p.unit || '' }))
);

function colorOf(key) {
  const idx = paramList.value.findIndex((p) => p.param_key === key);
  return PALETTE[(idx < 0 ? 0 : idx) % PALETTE.length];
}

function hexToRgba(hex, alpha) {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function isSelected(key) {
  return selected.value.includes(key);
}

function isHidden(key) {
  return hiddenKeys.value.includes(key);
}

function fmtNum(v) {
  if (v == null || v === '' || Number.isNaN(Number(v))) return '--';
  const n = Number(v);
  if (Math.abs(n) >= 100) return n.toFixed(0);
  if (Math.abs(n) >= 10) return n.toFixed(1);
  return n.toFixed(2);
}

function toTs(str) {
  return new Date(String(str).replace(' ', 'T')).getTime();
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function fmtTickTime(ts) {
  const d = new Date(ts);
  return `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

// 每个数据点的 X 坐标（按采集时间比例分布）
const xs = computed(() => {
  const list = rows.value;
  if (!list.length) return [];
  const ts = list.map((r) => toTs(r.collect_time));
  const t0 = ts[0];
  const span = ts[ts.length - 1] - t0 || 1;
  return ts.map((t) => PAD.l + ((t - t0) / span) * INNER_W);
});

// 曲线数据：每条参数独立归一化（不同参数量纲差异大），也可切换为原始值
const series = computed(() => {
  const list = rows.value;
  if (!list.length || !selectedMeta.value.length) return [];

  const xsLocal = xs.value;
  const numeric = selectedMeta.value.map((m) => ({
    meta: m,
    vals: list.map((r) => {
      const raw = r[m.key];
      if (raw === null || raw === undefined || raw === '') return null;
      const v = Number(raw);
      return Number.isNaN(v) ? null : v;
    }),
  }));

  return numeric.map(({ meta: m, vals }) => {
    const valid = vals.filter((v) => v != null);
    const vMin = valid.length ? Math.min(...valid) : 0;
    const vMax = valid.length ? Math.max(...valid) : 1;

    // 每条曲线按自身量程映射到绘图区，量纲差异不会压扁某条曲线；
    // 纵轴刻度由当前基准曲线(axisSeries)的真实数值生成
    const dMin = vMin;
    const dMax = vMax === vMin ? vMin + 1 : vMax;
    const yOf = (v) => PAD.t + (1 - (v - dMin) / (dMax - dMin)) * INNER_H;

    let path = '';
    let started = false;
    vals.forEach((v, i) => {
      if (v == null) { started = false; return; }
      const x = xsLocal[i];
      const y = yOf(v);
      path += `${started ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)} `;
      started = true;
    });

    const lastVal = [...vals].reverse().find((v) => v != null);
    return {
      key: m.key,
      name: m.name,
      unit: m.unit,
      color: colorOf(m.key),
      path,
      vals,
      min: vMin,
      max: vMax,
      lastVal,
      domainMin: dMin,
      domainMax: dMax,
      yOf,
    };
  });
});

const visibleSeries = computed(() => series.value.filter((s) => !isHidden(s.key)));

// 纵轴基准曲线：多条参数量纲不同时，纵轴刻度跟随其中一条显示真实数值，点击图例即可切换
const axisSeries = computed(() => {
  const list = visibleSeries.value;
  if (!list.length) return null;
  return list.find((s) => s.key === axisKey.value) || list[0];
});

// 可见曲线变化后（隐藏 / 重新查询），保证基准曲线仍然有效
watch(
  () => visibleSeries.value.map((s) => s.key).join(','),
  () => {
    const list = visibleSeries.value;
    if (!list.length) return;
    if (!list.some((s) => s.key === axisKey.value)) axisKey.value = list[0].key;
  }
);

// Y 轴刻度：按基准曲线的真实参数值生成（不再使用百分比）
const yTicks = computed(() => {
  const s = axisSeries.value;
  const out = [];
  for (let i = 0; i <= 4; i++) {
    const ratio = i / 4;
    const y = PAD.t + (1 - ratio) * INNER_H;
    const label = s ? fmtNum(s.domainMin + ratio * (s.domainMax - s.domainMin)) : '';
    out.push({ y, label });
  }
  return out;
});

const xTicks = computed(() => {
  const list = rows.value;
  if (!list.length) return [];
  const ts = list.map((r) => toTs(r.collect_time));
  const t0 = ts[0];
  const span = ts[ts.length - 1] - t0 || 1;
  const n = list.length === 1 ? 1 : 6;
  const out = [];
  for (let i = 0; i < n; i++) {
    const ratio = n === 1 ? 0 : i / (n - 1);
    out.push({ x: PAD.l + ratio * INNER_W, label: fmtTickTime(t0 + span * ratio) });
  }
  return out;
});

const hover = computed(() => {
  const i = hoverIndex.value;
  if (i < 0 || !rows.value[i]) return null;
  const x = xs.value[i];
  const dots = visibleSeries.value
    .filter((s) => s.vals[i] != null)
    .map((s) => ({ key: s.key, color: s.color, y: s.yOf(s.vals[i]) }));
  return {
    time: rows.value[i].collect_time,
    x,
    dots,
    items: visibleSeries.value.map((s) => ({
      key: s.key,
      name: s.name,
      color: s.color,
      unit: s.unit,
      value: s.vals[i],
    })),
  };
});

const tipStyle = computed(() => {
  const h = hover.value;
  if (!h) return {};
  const pct = Math.max(10, Math.min(90, (h.x / W) * 100));
  return { left: `${pct}%` };
});

const chartSummary = computed(() => {
  if (!rows.value.length) return '';
  return `（${series.value.length} 条曲线 / ${rows.value.length} 个数据点）`;
});

const chartModeText = computed(() => {
  if (!rows.value.length) return '';
  if (chartMode.value === 'range') {
    const f = rows.value[0].collect_time;
    const l = rows.value[rows.value.length - 1].collect_time;
    return `时间范围：${f} ~ ${l}`;
  }
  return `最近 ${chartLimit.value} 条记录：${rows.value[0].collect_time} ~ ${rows.value[rows.value.length - 1].collect_time}`;
});

function onMove(e) {
  const rect = e.currentTarget.getBoundingClientRect();
  if (!rect.width || !xs.value.length) return;
  const xInSvg = ((e.clientX - rect.left) / rect.width) * W;
  const arr = xs.value;
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < arr.length; i++) {
    const d = Math.abs(arr[i] - xInSvg);
    if (d < bestD) { bestD = d; best = i; }
  }
  hoverIndex.value = best;
}

async function loadMeta() {
  try {
    const [params, filterData] = await Promise.all([
      apiGet('/api/process/params'),
      apiGet('/api/process/filters'),
    ]);
    paramList.value = Array.isArray(params) ? params : [];
    deviceList.value = filterData.deviceList || [];
    productList.value = filterData.products || [];
    if (!selected.value.length && paramList.value.length) {
      // 默认选中前两个参数，便于直接看到效果
      selected.value = paramList.value.slice(0, 2).map((p) => p.param_key);
    }
  } catch (e) {
    console.error('加载工艺参数失败', e);
    errorMsg.value = `加载工艺参数失败：${e.message}`;
  }
}

async function loadSeries() {
  if (!selected.value.length) {
    errorMsg.value = '请至少选择一个工艺参数';
    rows.value = [];
    return;
  }
  loading.value = true;
  errorMsg.value = '';
  try {
    const q = new URLSearchParams();
    q.set('params', selected.value.join(','));
    if (filters.value.device) q.set('device', filters.value.device);
    if (filters.value.product) q.set('product', filters.value.product);

    const byRange = !!(filters.value.startTime || filters.value.endTime);
    if (byRange) {
      if (filters.value.startTime) q.set('startTime', filters.value.startTime.replace('T', ' '));
      if (filters.value.endTime) q.set('endTime', filters.value.endTime.replace('T', ' '));
    } else {
      q.set('limit', String(limit.value));
    }

    const data = await apiGet(`/api/process/chart?${q.toString()}`);
    rows.value = data.rows || [];
    chartMode.value = data.mode || 'limit';
    chartLimit.value = data.limit || limit.value;
    hoverIndex.value = -1;
    if (!rows.value.length) errorMsg.value = '';
  } catch (e) {
    console.error('加载曲线数据失败', e);
    rows.value = [];
    errorMsg.value = `加载曲线数据失败：${e.message}`;
  } finally {
    loading.value = false;
  }
}

function toggleParam(key) {
  if (isSelected(key)) {
    if (selected.value.length <= 1) return; // 至少保留一个参数
    selected.value = selected.value.filter((k) => k !== key);
    hiddenKeys.value = hiddenKeys.value.filter((k) => k !== key);
  } else {
    selected.value = [...selected.value, key];
  }
  loadSeries();
}

function toggleHidden(key) {
  hiddenKeys.value = isHidden(key)
    ? hiddenKeys.value.filter((k) => k !== key)
    : [...hiddenKeys.value, key];
}

// 点击图例切换纵轴基准曲线（若该曲线已隐藏则同时恢复显示）
function toggleAxis(key) {
  if (isHidden(key)) hiddenKeys.value = hiddenKeys.value.filter((k) => k !== key);
  axisKey.value = key;
}

function resetFilter() {
  filters.value = { device: '', product: '', startTime: '', endTime: '' };
  limit.value = 100;
  hiddenKeys.value = [];
  loadSeries();
}

watch(
  () => props.active,
  async (val) => {
    if (!val) return;
    // 首次进入需先拿到参数清单（含默认选中项）再查询，否则会因未选参数而报错
    if (!paramList.value.length) await loadMeta();
    loadSeries();
  }
);

onMounted(async () => {
  if (props.active) {
    await loadMeta();
    loadSeries();
  }
});
</script>

<style scoped>
.param-select {
  width: 100%;
}

.param-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

.param-chip {
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid var(--border-color);
  color: var(--text-secondary);
  border-radius: 16px;
  padding: 6px 14px;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.2s ease;
  white-space: nowrap;
}

.param-chip:hover {
  background: rgba(255, 255, 255, 0.08);
}

.param-chip.on {
  font-weight: 600;
}

.chip-unit {
  margin-left: 4px;
  font-size: 11px;
  opacity: 0.65;
}

.param-loading {
  font-size: 12px;
  color: var(--text-secondary);
}

.chart-card {
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: 12px;
  padding: 18px 20px 10px;
}

.chart-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  flex-wrap: wrap;
  gap: 10px;
}

.chart-head .module-title {
  margin-bottom: 0;
}

.chart-sub {
  font-size: 12px;
  font-weight: 400;
  color: var(--text-secondary);
  margin-left: 6px;
}

.legend {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  max-width: 70%;
  justify-content: flex-end;
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 6px;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 14px;
  padding: 3px 10px;
  color: var(--text-primary);
  font-size: 12px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.legend-item:hover {
  background: rgba(255, 255, 255, 0.06);
}

.legend-item i {
  width: 10px;
  height: 10px;
  border-radius: 3px;
  display: inline-block;
}

.legend-item.off {
  opacity: 0.35;
}

/* 当前作为纵轴基准的曲线 */
.legend-item.axis {
  background: rgba(255, 255, 255, 0.07);
  border-color: var(--border-color);
}

.legend-hide {
  margin-left: 2px;
  font-size: 14px;
  line-height: 1;
  color: var(--text-secondary);
  opacity: 0.45;
}

.legend-hide:hover {
  color: #ff4d4f;
  opacity: 1;
}

.axis-note {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin-top: 10px;
  font-size: 12px;
  color: var(--text-secondary);
}

.axis-note b {
  font-weight: 600;
}

.legend-val {
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
}

.chart-box {
  position: relative;
  margin-top: 8px;
}

.chart-svg {
  width: 100%;
  height: auto;
  display: block;
}

.grid line {
  stroke: rgba(255, 255, 255, 0.08);
  stroke-width: 1;
}

.axis text {
  fill: var(--text-secondary);
  font-size: 11px;
  font-family: 'Microsoft YaHei', Arial, sans-serif;
}

.chart-tip {
  position: absolute;
  top: 10px;
  transform: translateX(-50%);
  background: rgba(9, 20, 34, 0.96);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  padding: 8px 10px;
  min-width: 160px;
  font-size: 12px;
  pointer-events: none;
  z-index: 5;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.35);
}

.tip-time {
  color: var(--text-secondary);
  font-size: 11px;
  margin-bottom: 5px;
}

.tip-row {
  display: flex;
  align-items: center;
  gap: 6px;
  line-height: 1.7;
}

.tip-row i {
  width: 8px;
  height: 8px;
  border-radius: 2px;
  flex: none;
}

.tip-row b {
  margin-left: auto;
  font-variant-numeric: tabular-nums;
}

.chart-empty {
  padding: 70px 0;
  text-align: center;
  color: var(--text-secondary);
  font-size: 13px;
}

.chart-foot {
  display: flex;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
  padding: 10px 2px 2px;
  font-size: 12px;
  color: var(--text-secondary);
}
</style>
