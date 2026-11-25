<template>
  <section class="page device-manage">
    <div class="dashboard-header">
      <h1 class="dashboard-title">设备管理</h1>
      <div class="header-actions">
        <button v-if="can('device', 'create')" class="refresh-btn" @click="openCreate">+ 新增设备</button>
      </div>
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
      <div class="stat-item">
        <div class="stat-icon offline">&#9208;</div>
        <div class="stat-info">
          <div class="stat-num">{{ stats.inactive }}</div>
          <div class="stat-label">已停用</div>
        </div>
      </div>
    </div>

    <div class="tech-data-container">
      <div class="filter-bar">
        <div class="filter-group">
          <label>关键字</label>
          <input v-model="filter.keyword" placeholder="设备名称 / 编号 / 位置" @keyup.enter="loadDevices" />
        </div>
        <div class="filter-group">
          <label>设备类型</label>
          <select v-model="filter.type">
            <option value="">全部类型</option>
            <option v-for="t in types" :key="t" :value="t">{{ t }}</option>
          </select>
        </div>
        <div class="filter-group">
          <label>启用状态</label>
          <select v-model="filter.active">
            <option value="">全部</option>
            <option value="1">启用</option>
            <option value="0">停用</option>
          </select>
        </div>
        <button class="btn-search" @click="loadDevices">搜索</button>
        <button class="btn-reset" @click="resetFilter">重置</button>
      </div>

      <div v-if="deviceLoading" class="page-hint">数据加载中…</div>

      <div class="data-table-wrapper">
        <div class="data-toolbar">
          <span>共 <b>{{ total }}</b> 台设备</span>
          <span v-if="message" class="device-message">{{ message }}</span>
        </div>

        <div class="table-scroll">
          <table class="data-table">
            <thead>
              <tr>
                <th class="idx-col">序号</th>
                <th>设备编号</th>
                <th>设备名称</th>
                <th>设备类型</th>
                <th>安装位置</th>
                <th>当前状态</th>
                <th>关联工艺数据</th>
                <th>启用状态</th>
                <th style="width:150px;">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(d, idx) in devices" :key="d.id">
                <td class="idx-col">{{ idx + 1 }}</td>
                <td class="code-cell">{{ d.device_code }}</td>
                <td>{{ d.device_name }}</td>
                <td>{{ d.device_type }}</td>
                <td>{{ d.location || '--' }}</td>
                <td v-html="statusHtml(d)"></td>
                <td>
                  <span :class="{ 'usage-link': d.process_count > 0 }">{{ d.process_count }} 条</span>
                </td>
                <td>
                  <span class="active-tag" :class="Number(d.is_active) === 1 ? 'on' : 'off'">
                    {{ Number(d.is_active) === 1 ? '启用' : '停用' }}
                  </span>
                </td>
                <td>
                  <button v-if="can('device', 'update')" class="link-btn" @click="openEdit(d)">编辑</button>
                  <button v-if="can('device', 'delete')" class="link-btn danger" @click="askDelete(d)">删除</button>
                </td>
              </tr>
              <tr v-if="!devices.length">
                <td colspan="9" style="text-align:center;color:var(--text-secondary);padding:30px 0;">暂无设备，点击「新增设备」创建</td>
              </tr>
            </tbody>
          </table>
        </div>

      </div>
    </div>

    <DeviceEditDialog
      :visible="dialogVisible"
      :device="editingDevice"
      :types="types"
      @close="dialogVisible = false"
      @saved="onSaved"
    />

    <AppDialog
      :visible="confirmState.visible"
      title="删除设备"
      :message="confirmState.message"
      mode="confirm"
      @confirm="handleConfirm"
      @cancel="confirmState.visible = false"
    />
  </section>
</template>

<script setup>
import { ref, watch, onMounted } from 'vue';
import { apiGet, apiPost, escapeHtml } from '../../shared/api';
import { can } from '../../shared/auth';
import DeviceEditDialog from './DeviceEditDialog.vue';
import AppDialog from '../../shared/AppDialog.vue';

const props = defineProps({
  active: { type: Boolean, default: false },
});

const devices = ref([]);
const types = ref([]);
const total = ref(0);
const stats = ref({ total: 0, running: 0, warning: 0, error: 0, active: 0, inactive: 0 });
const filter = ref({ keyword: '', type: '', active: '' });
const dialogVisible = ref(false);
const editingDevice = ref(null);
const message = ref('');
const deviceLoading = ref(false);
const confirmState = ref({ visible: false, message: '', device: null });

function statusHtml(d) {
  // 未启用设备统一显示「关机」，不展示其历史运行状态
  if (Number(d.is_active) !== 1) {
    return '<span class="status-badge offline" title="设备未启用" style="padding:2px 10px;margin:0;width:auto;"><span class="status-icon offline"></span>关机</span>';
  }
  const status = d.status || 'running';
  const map = {
    running: ['running', '运行中'],
    warning: ['warning', '警告'],
    error: ['error', '故障'],
    offline: ['offline', '关机'],
  };
  const [cls, text] = map[status] || ['offline', '未知'];
  const tip = escapeHtml(d.alarm_info || d.detail_info || '');
  return `<span class="status-badge ${cls}" title="${tip}" style="padding:2px 10px;margin:0;width:auto;"><span class="status-icon ${cls}"></span>${text}</span>`;
}

function flash(text) {
  message.value = text;
  setTimeout(() => {
    if (message.value === text) message.value = '';
  }, 4000);
}

async function loadDevices() {
  deviceLoading.value = true;
  try {
    const params = new URLSearchParams();
    if (filter.value.keyword) params.set('keyword', filter.value.keyword);
    if (filter.value.type) params.set('type', filter.value.type);
    if (filter.value.active !== '') params.set('active', filter.value.active);
    const data = await apiGet(`/api/devices/list?${params.toString()}`);
    devices.value = data.devices || [];
    types.value = data.types || [];
    total.value = data.total || 0;
    stats.value = data.stats || stats.value;
  } catch (e) {
    console.error('加载设备列表失败', e);
    devices.value = [];
    total.value = 0;
    flash(`加载失败：${e.message}`);
  } finally {
    deviceLoading.value = false;
  }
}

function resetFilter() {
  filter.value = { keyword: '', type: '', active: '' };
  loadDevices();
}

function openCreate() {
  editingDevice.value = null;
  dialogVisible.value = true;
}

function openEdit(device) {
  editingDevice.value = device;
  dialogVisible.value = true;
}

function onSaved() {
  flash('设备信息已保存');
  loadDevices();
}

function askDelete(device) {
  const used = device.process_count || 0;
  confirmState.value = {
    visible: true,
    device,
    message: used > 0
      ? `设备【${device.device_name}】已被 ${used} 条工艺数据引用，删除会破坏关联，请先处理关联数据。`
      : `确定删除设备【${device.device_name}（${device.device_code}）】？删除后其状态与报警记录一并清除。`,
  };
}

async function handleConfirm() {
  const device = confirmState.value.device;
  confirmState.value.visible = false;
  if (!device) return;
  try {
    await apiPost('/api/devices/delete', { id: device.id });
    flash(`设备【${device.device_name}】已删除`);
    loadDevices();
  } catch (e) {
    flash(e.message || '删除失败');
  }
}

watch(
  () => props.active,
  (val) => {
    if (val) loadDevices();
  }
);

onMounted(() => {
  if (props.active) loadDevices();
});
</script>

<style scoped>
.header-actions {
  display: flex;
  gap: 12px;
}

.device-message {
  color: #40a9ff;
  font-size: 12px;
}

.code-cell {
  font-family: 'Courier New', monospace;
  color: #40a9ff;
}

.usage-link {
  color: #faad14;
}

.active-tag {
  display: inline-block;
  padding: 1px 10px;
  border-radius: 10px;
  font-size: 12px;
}

.active-tag.on {
  background: rgba(82, 196, 26, 0.15);
  color: #52c41a;
}

.active-tag.off {
  background: rgba(140, 155, 175, 0.15);
  color: #8ba3c7;
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
