<template>
  <div class="plan-overlay" v-if="visible" @click.self="close">
    <div class="plan-dialog">
      <div class="plan-dialog-header">
        <h3>{{ isEdit ? '编辑计划' : '新增计划（起草）' }}</h3>
        <button class="plan-close" @click="close">&times;</button>
      </div>

      <div class="plan-dialog-body">
        <div class="plan-error" v-if="error">{{ error }}</div>

        <div class="plan-form">
          <label>计划编号
            <input v-model="form.plan_code" :disabled="locked" :placeholder="isEdit ? '' : '留空自动生成'" />
          </label>
          <label>计划名称
            <input v-model="form.plan_name" placeholder="如：11-17 白班计划" />
          </label>
          <label>设备 <i>*</i>
            <select v-model="form.device_code" :disabled="locked">
              <option value="">请选择设备</option>
              <option v-for="d in options.devices" :key="d.device_code" :value="d.device_code">
                {{ d.device_code }} {{ d.device_name }}
              </option>
            </select>
          </label>
          <label>产品型号
            <select v-model="form.product_model" :disabled="locked">
              <option value="">全部产品</option>
              <option v-for="p in options.products" :key="p" :value="p">{{ p }}</option>
            </select>
          </label>
          <label>计划数 <i>*</i>
            <input v-model.number="form.plan_count" type="number" min="1" step="1" :disabled="locked" />
          </label>
          <label>状态
            <span class="plan-status-readonly" :class="'st-' + (form.status || 'draft')">{{ statusLabel }}</span>
          </label>
          <label>开始时间 <i>*</i>
            <input v-model="form.start_time" type="datetime-local" :disabled="locked" />
          </label>
          <label>结束时间 <i>*</i>
            <input v-model="form.end_time" type="datetime-local" :disabled="locked" />
          </label>
          <label class="wide">备注
            <input v-model="form.remark" placeholder="选填" />
          </label>
        </div>

        <div class="plan-lock-hint" v-if="locked">
          计划已下达，排产要素（编号 / 设备 / 产品 / 计划数 / 时间）不可修改；如需调整请先在列表中「撤回」为起草。
        </div>

        <div class="plan-logs" v-if="isEdit">
          <div class="plan-logs-title">流转记录</div>
          <div class="plan-logs-list">
            <div class="plan-log-item" v-for="log in logs" :key="log.id">
              <span class="log-time">{{ log.operate_time }}</span>
              <span class="log-action">{{ actionText(log) }}</span>
              <span class="log-operator">{{ log.operator }}</span>
              <span class="log-remark">{{ log.remark }}</span>
            </div>
            <div v-if="!logs.length" class="plan-log-empty">暂无流转记录</div>
          </div>
        </div>

      </div>

      <div class="plan-dialog-actions">
        <button class="plan-btn" @click="close">取消</button>
        <button class="plan-btn primary" :disabled="saving" @click="submit">
          {{ saving ? '保存中...' : '保存' }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue';
import { apiGet, apiPost } from '../api';

const props = defineProps({
  visible: { type: Boolean, default: false },
  plan: { type: Object, default: null },
  options: { type: Object, default: () => ({ devices: [], products: [] }) },
});

const emit = defineEmits(['close', 'saved']);

function todayAt(hhmm) {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${hhmm}`;
}

const emptyForm = () => ({
  plan_code: '',
  plan_name: '',
  device_code: '',
  product_model: '',
  plan_count: 100,
  start_time: todayAt('00:00'),
  end_time: todayAt('23:59'),
  status: 'draft',
  remark: '',
});

const form = ref(emptyForm());
const error = ref('');
const saving = ref(false);
const logs = ref([]);

const isEdit = computed(() => !!(props.plan && props.plan.id));

// 已下达后只能改名称与备注；排产要素需撤回为起草后再调整
const locked = computed(() => isEdit.value && props.plan && props.plan.status !== 'draft');

const STATUS_TEXT = {
  draft: '起草中',
  issued: '已下达',
  running: '执行中',
  paused: '已暂停',
  completed: '已完成',
  closed: '已结案',
  cancelled: '已取消',
};

const ACTION_TEXT = {
  create: '创建',
  update: '修改',
  delete: '删除',
  issued: '下达',
  running: '开始执行 / 恢复',
  paused: '暂停',
  completed: '完成',
  closed: '结案',
  cancelled: '取消',
  draft: '撤回 / 恢复起草',
};

const statusLabel = computed(() => STATUS_TEXT[form.value.status] || form.value.status || '起草中');

function actionText(log) {
  return ACTION_TEXT[log.action] || log.action;
}

async function loadLogs() {
  logs.value = [];
  if (!isEdit.value) return;
  try {
    const list = await apiGet(`/api/plans/logs?id=${props.plan.id}&limit=50`);
    logs.value = Array.isArray(list) ? list : [];
  } catch (e) {
    logs.value = [];
  }
}

function toLocalInput(value) {
  const s = String(value || '');
  return s.length >= 16 ? s.slice(0, 16).replace(' ', 'T') : '';
}

function fillForm() {
  error.value = '';
  if (props.plan) {
    form.value = {
      plan_code: props.plan.plan_code || '',
      plan_name: props.plan.plan_name || '',
      device_code: props.plan.device_code || '',
      product_model: props.plan.product_model || '',
      plan_count: Number(props.plan.plan_count) || 1,
      start_time: toLocalInput(props.plan.start_time),
      end_time: toLocalInput(props.plan.end_time),
      status: props.plan.status || 'running',
      remark: props.plan.remark || '',
    };
  } else {
    form.value = emptyForm();
  }
}

watch(
  () => props.visible,
  (val) => {
    if (val) {
      fillForm();
      loadLogs();
    }
  }
);

async function submit() {
  error.value = '';
  const data = form.value;
  const planCount = Number(data.plan_count);

  if (!locked.value) {
    if (!data.device_code) { error.value = '请选择设备'; return; }
    if (!Number.isInteger(planCount) || planCount <= 0) { error.value = '计划数必须是大于 0 的整数'; return; }
    if (!data.start_time || !data.end_time) { error.value = '请填写计划开始与结束时间'; return; }
    if (data.start_time >= data.end_time) { error.value = '结束时间必须晚于开始时间'; return; }
  }

  saving.value = true;
  try {
    // 状态由流转操作驱动，保存时不再提交 status
    const payload = {
      plan_name: data.plan_name.trim(),
      remark: data.remark,
    };
    if (!locked.value) {
      Object.assign(payload, {
        plan_code: data.plan_code.trim(),
        device_code: data.device_code,
        product_model: data.product_model,
        plan_count: planCount,
        start_time: data.start_time,
        end_time: data.end_time,
      });
    }
    if (isEdit.value) {
      await apiPost('/api/plans/update', { id: props.plan.id, ...payload });
    } else {
      await apiPost('/api/plans/create', payload);
    }
    emit('saved');
    emit('close');
  } catch (e) {
    error.value = e.message || '保存失败';
  } finally {
    saving.value = false;
  }
}

function close() {
  emit('close');
}
</script>

<style scoped>
.plan-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9998;
  padding: 20px;
}
.plan-dialog {
  width: 720px;
  max-width: 96vw;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  background: #16202e;
  border: 1px solid #2a3a52;
  border-radius: 12px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.55);
}
.plan-dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid #24344a;
}
.plan-dialog-header h3 {
  margin: 0;
  font-size: 16px;
  color: #e6edf5;
}
.plan-close {
  background: none;
  border: none;
  color: #8ba3c7;
  font-size: 24px;
  line-height: 1;
  cursor: pointer;
}
.plan-close:hover { color: #e6edf5; }
.plan-dialog-body {
  padding: 16px 20px;
  overflow-y: auto;
}
.plan-error {
  margin-bottom: 12px;
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 13px;
  background: rgba(255, 77, 79, 0.12);
  color: #ff787e;
}
.plan-form {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px 16px;
}
.plan-form label {
  display: flex;
  flex-direction: column;
  gap: 5px;
  font-size: 12px;
  color: #8ba3c7;
}
.plan-form label i {
  color: #ff787e;
  font-style: normal;
}
.plan-form label.wide { grid-column: span 2; }
.plan-form input,
.plan-form select {
  background: #0d1420;
  border: 1px solid #2a3a52;
  border-radius: 6px;
  padding: 7px 10px;
  color: #e6edf5;
  font-size: 13px;
  outline: none;
  color-scheme: dark;
}
.plan-form input:focus,
.plan-form select:focus { border-color: #3b82f6; }
.plan-dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 14px 20px;
  border-top: 1px solid #24344a;
}
.plan-btn {
  padding: 7px 18px;
  border: 1px solid #2a3a52;
  border-radius: 6px;
  background: #1d2b3e;
  color: #c8d6e8;
  font-size: 13px;
  cursor: pointer;
}
.plan-btn:hover { border-color: #3b82f6; }
.plan-btn.primary { background: #3b82f6; border-color: #3b82f6; color: #fff; }
.plan-btn.primary:hover { background: #2f6fe0; }
.plan-btn:disabled { opacity: 0.6; cursor: not-allowed; }

.plan-form input:disabled,
.plan-form select:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

/* 状态只读展示 */
.plan-status-readonly {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 7px 10px;
  border-radius: 6px;
  font-size: 13px;
  border: 1px solid #2a3a52;
  background: #0d1420;
  color: #c8d6e8;
}
.plan-status-readonly.st-draft { color: #9aa8bb; }
.plan-status-readonly.st-issued { color: #6ea8ff; border-color: rgba(59, 130, 246, 0.5); }
.plan-status-readonly.st-running { color: #40a9ff; border-color: rgba(24, 144, 255, 0.45); }
.plan-status-readonly.st-paused { color: #faad14; border-color: rgba(250, 173, 20, 0.45); }
.plan-status-readonly.st-completed { color: #52c41a; border-color: rgba(82, 196, 26, 0.45); }
.plan-status-readonly.st-closed { color: #7bc96f; border-color: rgba(82, 196, 26, 0.3); }
.plan-status-readonly.st-cancelled { color: #8ba3c7; }

.plan-lock-hint {
  margin-top: 12px;
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 12px;
  line-height: 1.6;
  color: #f3c46a;
  background: rgba(250, 173, 20, 0.1);
  border: 1px solid rgba(250, 173, 20, 0.35);
}

/* 流转记录 */
.plan-logs {
  margin-top: 16px;
  padding-top: 12px;
  border-top: 1px solid #24344a;
}
.plan-logs-title {
  margin-bottom: 8px;
  font-size: 13px;
  color: #c8d6e8;
}
.plan-logs-list {
  max-height: 180px;
  overflow-y: auto;
  font-size: 12px;
  color: #8ba3c7;
}
.plan-log-item {
  display: grid;
  grid-template-columns: 138px 92px 70px 1fr;
  gap: 8px;
  padding: 5px 0;
  border-bottom: 1px dashed #1f2c3d;
}
.plan-log-item:last-child { border-bottom: none; }
.plan-log-item .log-time { color: #7d8ea6; }
.plan-log-item .log-action { color: #6ea8ff; }
.plan-log-item .log-operator { color: #9aa8bb; }
.plan-log-item .log-remark {
  color: #c8d6e8;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.plan-log-empty {
  padding: 8px 0;
  color: #6a7b91;
}
@media (max-width: 640px) {
  .plan-form { grid-template-columns: 1fr; }
  .plan-form label.wide { grid-column: span 1; }
}
</style>
