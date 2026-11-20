<template>
  <section class="page home">
    <div class="dashboard-header">
      <h1 class="dashboard-title">设备状态监控</h1>
    </div>

    <div class="stats-bar">
      <div class="stat-item">
        <div class="stat-icon total">&#128202;</div>
        <div class="stat-info">
          <div class="stat-num">{{ stats.total }}</div>
          <div class="stat-label">设备总数</div>
        </div>
      </div>
      <div class="stat-item">
        <div class="stat-icon running">&#9989;</div>
        <div class="stat-info">
          <div class="stat-num">{{ stats.running }}</div>
          <div class="stat-label">正常运行</div>
        </div>
      </div>
      <div class="stat-item">
        <div class="stat-icon warning">&#9888;</div>
        <div class="stat-info">
          <div class="stat-num">{{ stats.warning }}</div>
          <div class="stat-label">警告</div>
        </div>
      </div>
      <div class="stat-item">
        <div class="stat-icon error">&#10060;</div>
        <div class="stat-info">
          <div class="stat-num">{{ stats.error }}</div>
          <div class="stat-label">故障停机</div>
        </div>
      </div>
    </div>

    <div class="device-grid">
      <div
        v-for="device in devices"
        :key="device.id || device.device_name"
        class="device-card clickable"
        :class="device.status"
        @click="showDeviceAlarm(device)"
      >
        <div class="device-name">{{ device.device_name }}</div>
        <div class="device-code">{{ device.device_code }}</div>
        <div class="status-badge" :class="device.status">
          <span class="status-icon" :class="device.status"></span>
          {{ statusText(device.status) }}
        </div>
        <div class="device-detail">{{ device.alarm_info || device.detail_info || '设备运行正常' }}</div>
      </div>
    </div>

    <div v-if="alarmPanel" class="alarm-detail-panel">
      <div class="alarm-detail-header">
        <div>
          <h2>{{ alarmPanel.device_name }} - 报警详情</h2>
          <p>{{ alarmPanel.device_code }} &#183; {{ statusText(alarmPanel.status) }}</p>
        </div>
        <button class="btn-close-alarm" @click="closeAlarmPanel">关闭</button>
      </div>
      <div class="alarm-detail-content">
        <div v-for="log in alarmLogs" :key="log.time + log.message" class="alarm-log-item">
          <div class="alarm-log-time">{{ log.time }}</div>
          <div class="alarm-log-message">{{ log.message }}</div>
        </div>
        <div v-if="!alarmLogs.length" class="alarm-log-empty">暂无报警记录</div>
      </div>
    </div>
  </section>
</template>

<script setup>
import { ref, watch, onMounted, onBeforeUnmount } from 'vue';
import { apiGet } from '../../shared/api';

const props = defineProps({
  active: { type: Boolean, default: false },
});

const stats = ref({ total: 0, running: 0, warning: 0, error: 0 });
const devices = ref([]);
const alarmPanel = ref(null);
const alarmLogs = ref([]);

function statusText(status) {
  return status === 'running' ? '运行中' : status === 'warning' ? '警告' : '故障';
}

async function loadDeviceOverview() {
  try {
    const data = await apiGet('/api/devices/overview');
    stats.value = data.stats;
    devices.value = data.devices;
  } catch (e) {
    console.error('加载设备数据失败', e);
  }
}

async function showDeviceAlarm(device) {
  alarmPanel.value = device;
  alarmLogs.value = [];
  try {
    const data = await apiGet(`/api/devices/alarm-log?name=${encodeURIComponent(device.device_name)}`);
    alarmLogs.value = data.logs || [];
  } catch (e) {
    alarmLogs.value = [];
  }
}

function closeAlarmPanel() {
  alarmPanel.value = null;
  alarmLogs.value = [];
}

// 看板首页自动刷新，仅在当前页可见时运行，避免后台空转
const REFRESH_MS = 30000;
let refreshTimer = null;

function startAutoRefresh() {
  stopAutoRefresh();
  refreshTimer = setInterval(() => { loadDeviceOverview(); }, REFRESH_MS);
}

function stopAutoRefresh() {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
}

watch(
  () => props.active,
  (val) => {
    if (val) {
      loadDeviceOverview();
      startAutoRefresh();
    } else {
      stopAutoRefresh();
    }
  }
);

onMounted(() => {
  if (props.active) {
    loadDeviceOverview();
    startAutoRefresh();
  }
});

onBeforeUnmount(stopAutoRefresh);
</script>

<style scoped>
.device-code {
  font-size: 11px;
  color: var(--text-secondary);
  font-family: 'Courier New', monospace;
  margin-top: 2px;
}
</style>
