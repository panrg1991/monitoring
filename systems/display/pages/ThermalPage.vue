<template>
  <section class="page thermal">
    <div class="dashboard-header">
      <h1 class="dashboard-title">热成像温度监测</h1>
    </div>

    <div class="thermal-module">
      <div class="thermal-card">
        <div class="module-title">热成像温度分布图（最高 {{ maxTemp }}°C / 最低 {{ minTemp }}°C）</div>
        <div class="thermal-image" v-html="thermalImageSvg"></div>
        <div class="thermal-legend">
          <span class="legend-title">温度色阶：</span>
          <span class="legend-item"><i style="background:#1890ff"></i>&lt;160°C</span>
          <span class="legend-item"><i style="background:#36cfc9"></i>160~180</span>
          <span class="legend-item"><i style="background:#52c41a"></i>180~200</span>
          <span class="legend-item"><i style="background:#ffd666"></i>200~220</span>
          <span class="legend-item"><i style="background:#faad14"></i>220~240</span>
          <span class="legend-item"><i style="background:#ff7a45"></i>240~260</span>
          <span class="legend-item"><i style="background:#ff4d4f"></i>≥260°C</span>
        </div>
      </div>

      <div class="thermal-temperature-panel">
        <div class="module-title">温度点位分布</div>
        <div class="temperature-grid">
          <div
            v-for="p in thermalPoints"
            :key="p.point_name"
            class="temp-point"
          >
            <span class="point-name">{{ p.point_name }}</span>
            <span class="point-value" :style="{ color: pointColor(p.temperature, p) }">{{ p.temperature }}°C</span>
          </div>
        </div>
        <div v-if="!thermalPoints.length" class="alarm-log-empty">暂无温度点位数据</div>
      </div>
    </div>
  </section>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue';
import { apiGet } from '../../shared/api';

const props = defineProps({
  active: { type: Boolean, default: false },
});

const thermalRecord = ref(null);
const thermalPoints = ref([]);

// 接口字段为 max_temp / min_temp，兼容旧命名的 max_temperature / min_temperature
const maxTemp = computed(() => {
  const r = thermalRecord.value;
  const v = r ? (r.max_temp ?? r.max_temperature) : null;
  return v == null ? '--' : v;
});
const minTemp = computed(() => {
  const r = thermalRecord.value;
  const v = r ? (r.min_temp ?? r.min_temperature) : null;
  return v == null ? '--' : v;
});

// 右侧点位数字颜色：以 thermal_alarm_config 中该点位的 temp_high 为基准按比例分档，
// 超出上限直接红色报警；temp_low 作为下限（低于下限同样按低温蓝显示）。
// 比例取自左侧色阶(160/180/200/220/240/260)占上限 260 的比值，
// 因此当配置上限为 260 时，右侧与左侧热力图颜色完全一致。
const COLOR_BANDS = [
  { ratio: 0.923, color: '#ff7a45' }, // 240~260 橙红
  { ratio: 0.846, color: '#faad14' }, // 220~240 橙黄
  { ratio: 0.769, color: '#ffd666' }, // 200~220 浅黄
  { ratio: 0.692, color: '#52c41a' }, // 180~200 绿
  { ratio: 0.615, color: '#36cfc9' }, // 160~180 青
];
const DEFAULT_TEMP_HIGH = 260;

function pointColor(temp, point) {
  if (temp == null) return '#fff';
  const t = Number(temp);
  if (Number.isNaN(t)) return '#fff';

  const high = Number(point?.temp_high) > 0 ? Number(point.temp_high) : DEFAULT_TEMP_HIGH;
  const low = Number(point?.temp_low) > 0 ? Number(point.temp_low) : 0;

  if (t >= high) return '#ff4d4f';          // 达到/超过点位上限 → 报警红
  if (t < low) return '#1890ff';            // 低于点位下限 → 低温蓝
  for (const band of COLOR_BANDS) {
    if (t >= high * band.ratio) return band.color;
  }
  return '#1890ff';
}

// 红外热力图 SVG：网格数量与实际点位数量动态匹配（避免空格子），每格标注点位名称与温度
const thermalImageSvg = computed(() => {
  const pts = thermalPoints.value || [];
  const n = pts.length;
  const w = 640;

  // 无数据时展示占位图
  if (!n) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="200" viewBox="0 0 ${w} 200" style="width:100%;height:auto;display:block;"><rect width="${w}" height="200" fill="#0d1b2e" rx="12"/><text x="${w / 2}" y="108" fill="#8ba3c7" font-size="16" text-anchor="middle" font-family="Microsoft YaHei,Arial">暂无温度点位数据</text></svg>`;
  }

  // 按点位数量计算行列，使其恰好铺满（如 20 点位 → 5 列 × 4 行）
  const cols = Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);
  const cellW = w / cols;
  const cellH = Math.round(Math.min(112, Math.max(58, cellW * 0.7)));
  const h = rows * cellH;

  // 字号随格子大小自适应，避免点位多时文字重叠
  const nameSize = Math.max(10, Math.min(13, Math.round(cellW * 0.11)));
  const valSize = Math.max(12, Math.min(19, Math.round(cellW * 0.15)));

  let cells = '';
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const temp = parseFloat(p.temperature);
    const valid = temp != null && !isNaN(temp);
    const color = !valid ? '#0d1b2e'
      : temp >= 260 ? '#ff4d4f' : temp >= 240 ? '#ff7a45' : temp >= 220 ? '#faad14'
      : temp >= 200 ? '#ffd666' : temp >= 180 ? '#52c41a' : temp >= 160 ? '#36cfc9' : '#1890ff';
    // 背景亮时（黄/橙/红）用深色文字，暗时（蓝/青/绿）用白色文字
    const textColor = !valid ? '#8ba3c7' : temp >= 200 ? '#1f2937' : '#ffffff';
    const r = Math.floor(i / cols);
    const c = i % cols;
    const x = c * cellW;
    const y = r * cellH;
    const cx = x + cellW / 2;
    const name = String(p.point_name || `点位${i + 1}`);
    const label = valid ? `${temp.toFixed(0)}°C` : '--';
    cells += `<g><rect x="${x}" y="${y}" width="${cellW}" height="${cellH}" fill="${color}" opacity="0.92"><title>${name}: ${label}</title></rect>`
      + `<text x="${cx}" y="${y + cellH * 0.42}" fill="${textColor}" font-size="${nameSize}" text-anchor="middle" font-family="Microsoft YaHei,Arial" opacity="0.85">${name}</text>`
      + `<text x="${cx}" y="${y + cellH * 0.72}" fill="${textColor}" font-size="${valSize}" font-weight="600" text-anchor="middle" font-family="Arial">${label}</text></g>`;
  }

  // 网格分隔线
  const lines = [];
  for (let i = 0; i <= cols; i++) lines.push(`<line x1="${i * cellW}" y1="0" x2="${i * cellW}" y2="${h}"/>`);
  for (let i = 0; i <= rows; i++) lines.push(`<line x1="0" y1="${i * cellH}" x2="${w}" y2="${i * cellH}"/>`);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="width:100%;height:auto;display:block;"><rect width="${w}" height="${h}" fill="#0d1b2e"/>${cells}<g fill="none" stroke="#0d1b2e" stroke-width="1.5" opacity="0.55">${lines.join('')}</g></svg>`;
});

async function loadThermalData() {
  try {
    const data = await apiGet('/api/thermal/latest');
    thermalRecord.value = data.record;
    thermalPoints.value = data.points || [];
  } catch (e) {
    console.error('加载热成像数据失败', e);
  }
}

watch(
  () => props.active,
  (val) => {
    if (val) loadThermalData();
  }
);

onMounted(() => {
  if (props.active) loadThermalData();
});
</script>
