<template>
  <div class="dev-overlay" v-if="visible" @click.self="close">
    <div class="dev-dialog">
      <div class="dev-dialog-header">
        <h3>{{ isEdit ? '编辑设备' : '新增设备' }}</h3>
        <button class="dev-close" @click="close">&times;</button>
      </div>

      <div class="dev-dialog-body">
        <div class="dev-message" v-if="error">{{ error }}</div>
        <div class="dev-form">
          <label>设备名称 <i>*</i><input v-model="form.device_name" placeholder="如：压铸机" /></label>
          <label>设备编号 <i>*</i><input v-model="form.device_code" placeholder="如：YZJ-001" /></label>
          <label>设备类型 <i>*</i>
            <input v-model="form.device_type" list="device-type-options" placeholder="如：压铸机" />
            <datalist id="device-type-options">
              <option v-for="t in types" :key="t" :value="t"></option>
            </datalist>
          </label>
          <label>安装位置<input v-model="form.location" placeholder="如：压铸车间" /></label>
          <label>设备型号<input v-model="form.model" placeholder="选填" /></label>
          <label>生产厂家<input v-model="form.manufacturer" placeholder="选填" /></label>
          <label>安装日期<input v-model="form.install_date" type="date" /></label>
          <label>启用状态
            <select v-model.number="form.is_active">
              <option :value="1">启用</option>
              <option :value="0">停用</option>
            </select>
          </label>
          <label class="wide">备注说明<input v-model="form.description" placeholder="选填" /></label>
        </div>
      </div>

      <div class="dev-dialog-actions">
        <button class="dev-btn" @click="close">取消</button>
        <button class="dev-btn primary" :disabled="saving" @click="submit">{{ saving ? '保存中...' : '保存' }}</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue';
import { apiPost } from '../../shared/api';

const props = defineProps({
  visible: { type: Boolean, default: false },
  device: { type: Object, default: null },
  types: { type: Array, default: () => [] },
});

const emit = defineEmits(['close', 'saved']);

const emptyForm = () => ({
  device_name: '',
  device_code: '',
  device_type: '',
  location: '',
  model: '',
  manufacturer: '',
  install_date: '',
  description: '',
  is_active: 1,
});

const form = ref(emptyForm());
const error = ref('');
const saving = ref(false);

const isEdit = computed(() => !!(props.device && props.device.id));

function fillForm() {
  if (props.device) {
    form.value = {
      device_name: props.device.device_name || '',
      device_code: props.device.device_code || '',
      device_type: props.device.device_type || '',
      location: props.device.location || '',
      model: props.device.model || '',
      manufacturer: props.device.manufacturer || '',
      install_date: (props.device.install_date || '').slice(0, 10),
      description: props.device.description || '',
      is_active: Number(props.device.is_active) === 0 ? 0 : 1,
    };
  } else {
    form.value = emptyForm();
  }
  error.value = '';
}

watch(
  () => props.visible,
  (val) => {
    if (val) fillForm();
  }
);

async function submit() {
  error.value = '';
  if (!form.value.device_name.trim()) { error.value = '请填写设备名称'; return; }
  if (!form.value.device_code.trim()) { error.value = '请填写设备编号'; return; }
  if (!form.value.device_type.trim()) { error.value = '请填写设备类型'; return; }

  saving.value = true;
  try {
    if (isEdit.value) {
      await apiPost('/api/devices/update', { id: props.device.id, ...form.value });
    } else {
      await apiPost('/api/devices/create', form.value);
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
.dev-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9998;
  padding: 20px;
}
.dev-dialog {
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
.dev-dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid #24344a;
}
.dev-dialog-header h3 {
  margin: 0;
  font-size: 16px;
  color: #e6edf5;
}
.dev-close {
  background: none;
  border: none;
  color: #8ba3c7;
  font-size: 24px;
  line-height: 1;
  cursor: pointer;
}
.dev-close:hover { color: #e6edf5; }
.dev-dialog-body {
  padding: 16px 20px;
  overflow-y: auto;
}
.dev-message {
  margin-bottom: 12px;
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 13px;
  background: rgba(255, 77, 79, 0.12);
  color: #ff787e;
}
.dev-form {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px 16px;
}
.dev-form label {
  display: flex;
  flex-direction: column;
  gap: 5px;
  font-size: 12px;
  color: #8ba3c7;
}
.dev-form label i {
  color: #ff787e;
  font-style: normal;
}
.dev-form label.wide { grid-column: span 2; }
.dev-form input,
.dev-form select {
  background: #0d1420;
  border: 1px solid #2a3a52;
  border-radius: 6px;
  padding: 7px 10px;
  color: #e6edf5;
  font-size: 13px;
  outline: none;
}
.dev-form input:focus,
.dev-form select:focus { border-color: #3b82f6; }
.dev-dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 14px 20px;
  border-top: 1px solid #24344a;
}
.dev-btn {
  padding: 7px 18px;
  border: 1px solid #2a3a52;
  border-radius: 6px;
  background: #1d2b3e;
  color: #c8d6e8;
  font-size: 13px;
  cursor: pointer;
}
.dev-btn:hover { border-color: #3b82f6; }
.dev-btn.primary { background: #3b82f6; border-color: #3b82f6; color: #fff; }
.dev-btn.primary:hover { background: #2f6fe0; }
.dev-btn:disabled { opacity: 0.6; cursor: not-allowed; }
@media (max-width: 640px) {
  .dev-form { grid-template-columns: 1fr; }
  .dev-form label.wide { grid-column: span 1; }
}
</style>
