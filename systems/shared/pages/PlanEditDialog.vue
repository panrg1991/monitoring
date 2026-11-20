<template>
  <div class="plan-overlay" v-if="visible" @click.self="close">
    <div class="plan-dialog">
      <div class="plan-dialog-header">
        <h3>{{ isEdit ? '编辑计划' : '新增计划' }}</h3>
        <button class="plan-close" @click="close">&times;</button>
      </div>

      <div class="plan-dialog-body">
        <div class="plan-error" v-if="error">{{ error }}</div>

        <div class="plan-form">
          <label>计划编号
            <input v-model="form.plan_code" :placeholder="isEdit ? '' : '留空自动生成'" />
          </label>
          <label>计划名称
            <input v-model="form.plan_name" placeholder="如：11-17 白班计划" />
          </label>
          <label>设备 <i>*</i>
            <select v-model="form.device_code">
              <option value="">请选择设备</option>
              <option v-for="d in options.devices" :key="d.device_code" :value="d.device_code">
                {{ d.device_code }} {{ d.device_name }}
              </option>
            </select>
          </label>
          <label>产品型号
            <select v-model="form.product_model">
              <option value="">全部产品</option>
              <option v-for="p in options.products" :key="p" :value="p">{{ p }}</option>
            </select>
          </label>
          <label>计划数 <i>*</i>
            <input v-model.number="form.plan_count" type="number" min="1" step="1" />
          </label>
          <label>状态
            <select v-model="form.status">
              <option value="running">进行中</option>
              <option value="completed">已完成</option>
              <option value="cancelled">已取消</option>
            </select>
          </label>
          <label>开始时间 <i>*</i>
            <input v-model="form.start_time" type="datetime-local" />
          </label>
          <label>结束时间 <i>*</i>
            <input v-model="form.end_time" type="datetime-local" />
          </label>
          <label class="wide">备注
            <input v-model="form.remark" placeholder="选填" />
          </label>
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
import { apiPost } from '../api';

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
  status: 'running',
  remark: '',
});

const form = ref(emptyForm());
const error = ref('');
const saving = ref(false);

const isEdit = computed(() => !!(props.plan && props.plan.id));

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
    if (val) fillForm();
  }
);

async function submit() {
  error.value = '';
  const data = form.value;
  const planCount = Number(data.plan_count);

  if (!data.device_code) { error.value = '请选择设备'; return; }
  if (!Number.isInteger(planCount) || planCount <= 0) { error.value = '计划数必须是大于 0 的整数'; return; }
  if (!data.start_time || !data.end_time) { error.value = '请填写计划开始与结束时间'; return; }
  if (data.start_time >= data.end_time) { error.value = '结束时间必须晚于开始时间'; return; }

  saving.value = true;
  try {
    const payload = {
      plan_code: data.plan_code.trim(),
      plan_name: data.plan_name.trim(),
      device_code: data.device_code,
      product_model: data.product_model,
      plan_count: planCount,
      start_time: data.start_time,
      end_time: data.end_time,
      status: data.status,
      remark: data.remark,
    };
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
@media (max-width: 640px) {
  .plan-form { grid-template-columns: 1fr; }
  .plan-form label.wide { grid-column: span 1; }
}
</style>
