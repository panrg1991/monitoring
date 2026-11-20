<template>
  <div class="mold-overlay" v-if="visible" @click.self="close">
    <div class="mold-dialog">
      <div class="mold-dialog-header">
        <h3>{{ isEdit ? '编辑模具' : '新增模具' }}</h3>
        <button class="mold-close" @click="close">&times;</button>
      </div>

      <div class="mold-dialog-body">
        <div class="mold-message" v-if="error">{{ error }}</div>
        <div class="mold-form">
          <label>模具名称 <i>*</i>
            <input v-model="form.mold_name" placeholder="如：红岛模具" />
          </label>
          <label>模具编码
            <input v-model="form.mold_code" placeholder="如：MOLD-HD-001，留空表示不编码" />
          </label>
          <label>模具类型
            <input v-model="form.mold_type" list="mold-type-options" placeholder="如：压铸模" />
            <datalist id="mold-type-options">
              <option v-for="t in types" :key="t" :value="t"></option>
            </datalist>
          </label>
          <label>启用状态
            <select v-model.number="form.is_active">
              <option :value="1">启用</option>
              <option :value="0">停用</option>
            </select>
          </label>
          <label class="wide">说明<input v-model="form.description" placeholder="选填" /></label>
        </div>
      </div>

      <div class="mold-dialog-actions">
        <button class="mold-btn" @click="close">取消</button>
        <button class="mold-btn primary" :disabled="saving" @click="submit">{{ saving ? '保存中...' : '保存' }}</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue';
import { apiPost } from '../../shared/api';

const props = defineProps({
  visible: { type: Boolean, default: false },
  mold: { type: Object, default: null },
  types: { type: Array, default: () => [] },
});

const emit = defineEmits(['close', 'saved']);

const emptyForm = () => ({
  mold_name: '',
  mold_code: '',
  mold_type: '',
  description: '',
  is_active: 1,
});

const form = ref(emptyForm());
const error = ref('');
const saving = ref(false);

const isEdit = computed(() => !!(props.mold && props.mold.id));

function fillForm() {
  if (props.mold) {
    form.value = {
      mold_name: props.mold.mold_name || '',
      mold_code: props.mold.mold_code || '',
      mold_type: props.mold.mold_type || '',
      description: props.mold.description || '',
      is_active: Number(props.mold.is_active) === 0 ? 0 : 1,
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
  if (!form.value.mold_name.trim()) { error.value = '请填写模具名称'; return; }

  saving.value = true;
  try {
    if (isEdit.value) {
      await apiPost('/api/molds/update', { id: props.mold.id, ...form.value });
    } else {
      await apiPost('/api/molds/create', form.value);
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
.mold-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9998;
  padding: 20px;
}
.mold-dialog {
  width: 640px;
  max-width: 96vw;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  background: #16202e;
  border: 1px solid #2a3a52;
  border-radius: 12px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.55);
}
.mold-dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid #24344a;
}
.mold-dialog-header h3 {
  margin: 0;
  font-size: 16px;
  color: #e6edf5;
}
.mold-close {
  background: none;
  border: none;
  color: #8ba3c7;
  font-size: 24px;
  line-height: 1;
  cursor: pointer;
}
.mold-close:hover { color: #e6edf5; }
.mold-dialog-body {
  padding: 16px 20px;
  overflow-y: auto;
}
.mold-message {
  margin-bottom: 12px;
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 13px;
  background: rgba(255, 77, 79, 0.12);
  color: #ff787e;
}
.mold-form {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px 16px;
}
.mold-form label {
  display: flex;
  flex-direction: column;
  gap: 5px;
  font-size: 12px;
  color: #8ba3c7;
}
.mold-form label i {
  color: #ff787e;
  font-style: normal;
}
.mold-form label.wide { grid-column: span 2; }
.mold-form input,
.mold-form select {
  background: #0d1420;
  border: 1px solid #2a3a52;
  border-radius: 6px;
  padding: 7px 10px;
  color: #e6edf5;
  font-size: 13px;
  outline: none;
}
.mold-form input:focus,
.mold-form select:focus { border-color: #3b82f6; }
.mold-dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 14px 20px;
  border-top: 1px solid #24344a;
}
.mold-btn {
  padding: 7px 18px;
  border: 1px solid #2a3a52;
  border-radius: 6px;
  background: #1d2b3e;
  color: #c8d6e8;
  font-size: 13px;
  cursor: pointer;
}
.mold-btn:hover { border-color: #3b82f6; }
.mold-btn.primary { background: #3b82f6; border-color: #3b82f6; color: #fff; }
.mold-btn.primary:hover { background: #2f6fe0; }
.mold-btn:disabled { opacity: 0.6; cursor: not-allowed; }
@media (max-width: 640px) {
  .mold-form { grid-template-columns: 1fr; }
  .mold-form label.wide { grid-column: span 1; }
}
</style>
