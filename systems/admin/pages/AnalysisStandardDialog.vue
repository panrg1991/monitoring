<template>
  <div class="std-overlay" v-if="visible" @click.self="close">
    <div class="std-dialog">
      <div class="std-dialog-header">
        <div>
          <h3>分析标准管理</h3>
        </div>
        <button class="std-close" @click="close">&times;</button>
      </div>

      <div class="std-dialog-body">
        <div class="std-message" v-if="message" :class="messageType">{{ message }}</div>

        <!-- 版本区 -->
        <div class="std-version-bar">
          <label>标准版本</label>
          <select v-model="selectedVersionId" @change="onVersionChange">
            <option v-for="v in versions" :key="v.id" :value="v.id">
              {{ v.version_name }}（{{ v.version_code }}） · {{ formatRange(v) }}
            </option>
            <option v-if="!versions.length" :value="''">暂无标准版本</option>
          </select>
          <button class="std-btn primary" v-if="!showNewVersion" @click="showNewVersion = true">+ 新建版本</button>
          <button class="std-btn" v-else @click="showNewVersion = false">取消新建</button>
        </div>

        <!-- 新建版本 -->
        <div class="std-form-grid" v-if="showNewVersion">
          <label>版本名称<input v-model="newVersion.version_name" placeholder="如：标准3" /></label>
          <label>版本编码<input v-model="newVersion.version_code" placeholder="留空自动生成" /></label>
          <label>适用产品
            <input v-model="newVersion.product_model" placeholder="留空 = 全部产品通用" />
          </label>
          <label>生效开始<input v-model="newVersion.effective_from" type="datetime-local" /></label>
          <label>生效结束<input v-model="newVersion.effective_to" type="datetime-local" placeholder="留空 = 至今有效" /></label>
          <label class="wide">备注<input v-model="newVersion.remark" placeholder="备注说明" /></label>
          <div class="std-form-actions">
            <button class="std-btn primary" @click="createVersion">创建版本</button>
          </div>
        </div>

        <!-- 选中版本信息 -->
        <template v-if="selectedVersion">
          <div class="std-form-grid">
            <label>版本名称<input v-model="versionForm.version_name" /></label>
            <label>适用产品<input v-model="versionForm.product_model" placeholder="留空 = 全部产品通用" /></label>
            <label>生效开始<input v-model="versionForm.effective_from" type="datetime-local" /></label>
            <label>生效结束<input v-model="versionForm.effective_to" type="datetime-local" /></label>
            <label class="wide">备注<input v-model="versionForm.remark" /></label>
            <div class="std-form-actions">
              <button class="std-btn primary" @click="updateVersion">保存版本信息</button>
              <button class="std-btn danger" @click="deleteVersion">删除该版本</button>
            </div>
          </div>

          <!-- 待保存提示：排序 / 删除仅在点击「保存版本信息」后生效 -->
          <div class="std-pending-bar" :class="{ active: isDirty }">
            <template v-if="isDirty">
              <span>有 {{ pendingDeletes.length }} 项删除、{{ orderDirty ? '顺序调整' : '0 项顺序调整' }}待保存，点击「保存版本信息」后生效</span>
              <button class="std-btn small" @click="discardPending">放弃改动</button>
            </template>
            <template v-else>
              <span>顺序调整与删除均为暂存，点击「保存版本信息」后写入，直接关闭不会生效</span>
            </template>
          </div>

          <!-- 标准明细 -->
          <div class="std-table-wrap">
            <table class="std-table">
              <thead>
                <tr>
                  <th style="width:170px;">参数</th>
                  <th style="width:110px;">标准值</th>
                  <th style="width:100px;">容差 ±</th>
                  <th style="width:80px;">单位</th>
                  <th style="width:118px;">显示顺序</th>
                  <th style="width:140px;">操作</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(row, index) in editRows" :key="row.id">
                  <td>{{ row.param_name }}<span class="std-key">{{ row.param_key }}</span></td>
                  <td><input v-model="row.standard_value" type="number" step="any" /></td>
                  <td><input v-model="row.tolerance" type="number" step="any" /></td>
                  <td><input v-model="row.unit" /></td>
                  <td class="std-order-cell">
                    <button class="std-btn small icon" :disabled="index === 0" title="上移" @click="moveRow(index, -1)">&#9650;</button>
                    <span class="std-order-no">{{ index + 1 }}</span>
                    <button class="std-btn small icon" :disabled="index === editRows.length - 1" title="下移" @click="moveRow(index, 1)">&#9660;</button>
                  </td>
                  <td>
                    <button class="std-btn small primary" @click="updateStandard(row)">保存</button>
                    <button class="std-btn small danger" title="仅暂存，点击「保存版本信息」后生效" @click="deleteStandard(row)">删除</button>
                  </td>
                </tr>
                <tr v-if="!editRows.length">
                  <td colspan="6" class="std-empty">该版本还没有标准参数</td>
                </tr>
              </tbody>
            </table>
          </div>

          <!-- 新增参数标准 -->
          <div class="std-add-bar">
            <label>新增参数
              <select v-model="addForm.param_key" @change="onParamChange">
                <option value="">请选择工艺参数</option>
                <option v-for="p in availableParams" :key="p.param_key" :value="p.param_key">
                  {{ p.param_name }}（{{ p.param_key }}）
                </option>
              </select>
            </label>
            <label>标准值<input v-model="addForm.standard_value" type="number" step="any" /></label>
            <label>容差 ±<input v-model="addForm.tolerance" type="number" step="any" /></label>
            <label>单位<input v-model="addForm.unit" style="width:70px;" /></label>
            <button class="std-btn primary" :disabled="!addForm.param_key" @click="createStandard">添加</button>
          </div>
        </template>
      </div>
    </div>

    <AppDialog
      :visible="confirmState.visible"
      :title="confirmState.title"
      :message="confirmState.message"
      mode="confirm"
      @confirm="handleConfirm"
      @cancel="handleCancel"
    />
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue';
import { apiPost } from '../../shared/api';
import AppDialog from '../../shared/AppDialog.vue';

const props = defineProps({
  visible: { type: Boolean, default: false },
  versions: { type: Array, default: () => [] },
  params: { type: Array, default: () => [] },
  currentVersionId: { type: [Number, String], default: null },
});

const emit = defineEmits(['close', 'saved']);

const selectedVersionId = ref('');
const versionForm = ref({});
const editRows = ref([]);
const addForm = ref({ param_key: '', standard_value: '', tolerance: '', unit: '' });
const newVersion = ref(emptyNewVersion());
const showNewVersion = ref(false);
const message = ref('');
const messageType = ref('ok');
const confirmState = ref({ visible: false, title: '确认操作', message: '', action: null, cancelAction: null });

// 暂存改动：排序与删除先记在本地，点击「保存版本信息」时才写库
const pendingDeletes = ref([]);
const orderDirty = ref(false);
const loadedVersionId = ref('');
const isDirty = computed(() => pendingDeletes.value.length > 0 || orderDirty.value);

function resetPending() {
  pendingDeletes.value = [];
  orderDirty.value = false;
}

function emptyNewVersion() {
  return { version_name: '', version_code: '', product_model: '', effective_from: '', effective_to: '', remark: '' };
}

const selectedVersion = computed(
  () => props.versions.find((v) => String(v.id) === String(selectedVersionId.value)) || null
);

const availableParams = computed(() => {
  const used = new Set(editRows.value.map((r) => r.param_key));
  return props.params.filter((p) => !used.has(p.param_key));
});

function toInput(v) {
  if (!v) return '';
  return String(v).replace(' ', 'T').slice(0, 16);
}

function formatRange(v) {
  const from = (v.effective_from || '').slice(0, 16);
  const to = v.effective_to ? (v.effective_to || '').slice(0, 16) : '至今';
  return `${from} ~ ${to}`;
}

function flash(text, type = 'ok') {
  message.value = text;
  messageType.value = type;
  setTimeout(() => { if (message.value === text) message.value = ''; }, 3000);
}

function askConfirm(text, action, cancelAction = null) {
  confirmState.value = { visible: true, title: '确认操作', message: text, action, cancelAction };
}

function handleConfirm() {
  const action = confirmState.value.action;
  confirmState.value.visible = false;
  if (typeof action === 'function') action();
}

function handleCancel() {
  const cancelAction = confirmState.value.cancelAction;
  confirmState.value.visible = false;
  if (typeof cancelAction === 'function') cancelAction();
}

function loadSelected() {
  const v = selectedVersion.value;
  resetPending();
  if (!v) {
    versionForm.value = {};
    editRows.value = [];
    loadedVersionId.value = '';
    return;
  }
  loadedVersionId.value = String(v.id);
  versionForm.value = {
    version_name: v.version_name || '',
    product_model: v.product_model || '',
    effective_from: toInput(v.effective_from),
    effective_to: toInput(v.effective_to),
    remark: v.remark || '',
  };
  editRows.value = (v.standards || []).map((s) => ({ ...s }));
}

// 提交暂存的删除与顺序调整（仅在保存时调用）
async function flushPending() {
  const version = selectedVersion.value;
  if (!version || !isDirty.value) return;
  for (const row of pendingDeletes.value) {
    await apiPost('/api/analysis/standards/delete', { id: row.id });
  }
  if (editRows.value.length) {
    await apiPost('/api/analysis/standards/reorder', {
      version_id: version.id,
      ids: editRows.value.map((r) => r.id),
    });
  }
  resetPending();
}

// 放弃本地暂存的排序 / 删除改动
function discardPending() {
  if (!isDirty.value) return;
  loadSelected();
  flash('已放弃未保存的改动');
}

function onVersionChange() {
  if (!isDirty.value) {
    loadSelected();
    return;
  }
  const prevVersionId = loadedVersionId.value;
  askConfirm(
    '当前版本有未保存的顺序 / 删除改动，切换版本将放弃这些改动，确定切换？',
    () => loadSelected(),
    () => { selectedVersionId.value = prevVersionId; }
  );
}

watch(
  () => props.visible,
  (val) => {
    if (!val) return;
    message.value = '';
    showNewVersion.value = false;
    const preferred = props.currentVersionId || (props.versions[0] && props.versions[0].id);
    selectedVersionId.value = preferred || '';
    loadSelected();
  }
);

watch(
  () => props.versions,
  () => {
    if (!props.visible) return;
    if (!selectedVersionId.value && props.currentVersionId) {
      selectedVersionId.value = props.currentVersionId;
    }
    loadSelected();
  },
  { deep: true }
);

function onParamChange() {
  const p = props.params.find((x) => x.param_key === addForm.value.param_key);
  addForm.value.unit = p ? p.unit : '';
}

async function createVersion() {
  try {
    const body = { ...newVersion.value };
    if (!body.version_name) return flash('请填写版本名称', 'err');
    if (!body.effective_from) return flash('请填写生效开始时间', 'err');
    // 新建版本会刷新当前列表，先落地当前版本的暂存改动
    await flushPending();
    const res = await apiPost('/api/analysis/versions/create', body);
    flash(`版本【${res.version.version_name}】创建成功`);
    newVersion.value = emptyNewVersion();
    showNewVersion.value = false;
    if (res.version && res.version.id) selectedVersionId.value = res.version.id;
    emit('saved');
  } catch (e) {
    flash(e.message, 'err');
  }
}

async function updateVersion() {
  if (!selectedVersion.value) return;
  try {
    // 保存时统一提交暂存的排序与删除
    await flushPending();
    await apiPost('/api/analysis/versions/update', {
      id: selectedVersion.value.id,
      ...versionForm.value,
      effective_from: versionForm.value.effective_from,
      effective_to: versionForm.value.effective_to,
    });
    flash('版本信息与标准改动已保存');
    emit('saved');
  } catch (e) {
    flash(e.message, 'err');
  }
}

function deleteVersion() {
  if (!selectedVersion.value) return;
  const version = selectedVersion.value;
  askConfirm(`确定删除版本【${version.version_name}】及其全部标准明细？`, async () => {
    try {
      resetPending();
      await apiPost('/api/analysis/versions/delete', { id: version.id });
      flash('版本已删除');
      selectedVersionId.value = '';
      emit('saved');
    } catch (e) {
      flash(e.message, 'err');
    }
  });
}

async function updateStandard(row) {
  try {
    // 先提交暂存的排序 / 删除，避免刷新后丢失
    await flushPending();
    await apiPost('/api/analysis/standards/update', {
      id: row.id,
      standard_value: row.standard_value,
      tolerance: row.tolerance,
      unit: row.unit,
      param_name: row.param_name,
    });
    flash(`【${row.param_name}】标准已更新`);
    emit('saved');
  } catch (e) {
    flash(e.message, 'err');
  }
}

// 上移 / 下移：仅调整本地顺序，点击「保存版本信息」时才写入
function moveRow(index, delta) {
  const target = index + delta;
  if (target < 0 || target >= editRows.value.length) return;

  const rows = editRows.value.slice();
  const [moved] = rows.splice(index, 1);
  rows.splice(target, 0, moved);
  rows.forEach((r, i) => { r.display_order = i + 1; });
  editRows.value = rows;
  orderDirty.value = true;
  flash(`【${moved.param_name}】已${delta < 0 ? '上移' : '下移'}，点击「保存版本信息」后生效`);
}

// 删除：先本地移除并暂存，点击「保存版本信息」时才真正删除
function deleteStandard(row) {
  askConfirm(`确定移除【${row.param_name}】的分析标准？（需点击「保存版本信息」后生效）`, () => {
    const idx = editRows.value.findIndex((r) => r.id === row.id);
    if (idx >= 0) editRows.value.splice(idx, 1);
    pendingDeletes.value.push({ id: row.id, param_name: row.param_name });
    orderDirty.value = true;
    flash(`【${row.param_name}】已标记删除，点击「保存版本信息」后生效`);
  });
}

async function createStandard() {
  if (!selectedVersion.value) return;
  try {
    await flushPending();
    await apiPost('/api/analysis/standards/create', {
      version_id: selectedVersion.value.id,
      ...addForm.value,
    });
    flash('标准参数已添加');
    addForm.value = { param_key: '', standard_value: '', tolerance: '', unit: '' };
    emit('saved');
  } catch (e) {
    flash(e.message, 'err');
  }
}

function close() {
  if (isDirty.value) {
    askConfirm('存在未保存的顺序 / 删除改动，关闭后将不生效，确定放弃并关闭？', () => emit('close'));
    return;
  }
  emit('close');
}
</script>

<style scoped>
.std-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9998;
  padding: 20px;
}
.std-dialog {
  width: 900px;
  max-width: 96vw;
  max-height: 88vh;
  display: flex;
  flex-direction: column;
  background: #16202e;
  border: 1px solid #2a3a52;
  border-radius: 12px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.55);
}
.std-dialog-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid #24344a;
}
.std-dialog-header h3 {
  margin: 0;
  font-size: 16px;
  color: #e6edf5;
}
.std-close {
  background: none;
  border: none;
  color: #8ba3c7;
  font-size: 24px;
  line-height: 1;
  cursor: pointer;
}
.std-close:hover { color: #e6edf5; }
.std-dialog-body {
  padding: 16px 20px 20px;
  overflow-y: auto;
}
.std-message {
  margin-bottom: 12px;
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 13px;
}
.std-message.ok { background: rgba(82, 196, 26, 0.12); color: #7bd94c; }
.std-message.err { background: rgba(255, 77, 79, 0.12); color: #ff787e; }
.std-version-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  padding-bottom: 12px;
  border-bottom: 1px solid #24344a;
  margin-bottom: 14px;
}
.std-version-bar label { font-size: 13px; color: #8ba3c7; }
.std-version-bar select { min-width: 380px; }
select,
input {
  background: #0d1420;
  border: 1px solid #2a3a52;
  border-radius: 6px;
  padding: 6px 10px;
  color: #e6edf5;
  font-size: 13px;
  outline: none;
}
select:focus,
input:focus { border-color: #3b82f6; }
.std-form-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px 14px;
  margin-bottom: 14px;
}
.std-form-grid label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: #8ba3c7;
}
.std-form-grid label.wide { grid-column: span 3; }
.std-form-actions {
  grid-column: span 4;
  display: flex;
  gap: 10px;
  justify-content: flex-end;
}
.std-btn {
  padding: 6px 14px;
  border: 1px solid #2a3a52;
  border-radius: 6px;
  background: #1d2b3e;
  color: #c8d6e8;
  font-size: 13px;
  cursor: pointer;
}
.std-btn:hover { border-color: #3b82f6; }
.std-btn.primary { background: #3b82f6; border-color: #3b82f6; color: #fff; }
.std-btn.primary:hover { background: #2f6fe0; }
.std-btn.danger { background: rgba(255, 77, 79, 0.12); border-color: rgba(255, 77, 79, 0.5); color: #ff787e; }
.std-btn.small { padding: 3px 8px; font-size: 12px; margin-right: 6px; }
.std-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.std-table-wrap {
  max-height: 300px;
  overflow: auto;
  border: 1px solid #24344a;
  border-radius: 8px;
}
.std-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.std-table th {
  position: sticky;
  top: 0;
  background: #1a2637;
  color: #8ba3c7;
  font-weight: 600;
  text-align: left;
  padding: 9px 10px;
  border-bottom: 1px solid #24344a;
}
.std-table td {
  padding: 6px 10px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  color: #c8d6e8;
}
.std-table td input { width: 100%; box-sizing: border-box; }
.std-pending-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
  padding: 6px 12px;
  border: 1px solid #24344a;
  border-radius: 6px;
  font-size: 12px;
  color: #7d8ea6;
  background: #131d2a;
}
.std-pending-bar.active {
  border-color: rgba(250, 173, 20, 0.45);
  background: rgba(250, 173, 20, 0.1);
  color: #f3c46a;
}
.std-order-cell { white-space: nowrap; }
.std-order-cell .std-btn.icon {
  padding: 2px 6px;
  margin: 0;
  line-height: 1;
  font-size: 10px;
}
.std-order-no {
  display: inline-block;
  min-width: 22px;
  text-align: center;
  color: #8ba3c7;
  font-size: 12px;
}
.std-key {
  display: block;
  font-size: 11px;
  color: #6b7f99;
}
.std-empty { text-align: center; color: #7d8ea6; padding: 20px 0; }
.std-add-bar {
  display: flex;
  align-items: flex-end;
  gap: 10px;
  flex-wrap: wrap;
  margin-top: 14px;
}
.std-add-bar label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: #8ba3c7;
}
.std-add-bar input { width: 100px; }
@media (max-width: 900px) {
  .std-form-grid { grid-template-columns: 1fr 1fr; }
  .std-form-grid label.wide, .std-form-actions { grid-column: span 2; }
  .std-version-bar select { min-width: 220px; }
}
</style>
