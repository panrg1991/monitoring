<template>
  <div class="prod-overlay" v-if="visible" @click.self="close">
    <div class="prod-dialog">
      <div class="prod-dialog-header">
        <h3>{{ isEdit ? '编辑产品' : '新增产品' }}</h3>
        <button class="prod-close" @click="close">&times;</button>
      </div>

      <div class="prod-dialog-body">
        <div class="prod-message" v-if="error">{{ error }}</div>
        <div class="prod-form">
          <label>产品名称 <i>*</i>
            <input v-model="form.product_name" placeholder="如：有色压铸3500T" />
          </label>
          <label>产品编码
            <input v-model="form.product_code" placeholder="如：PROD-P3500T，留空表示不编码" />
          </label>
          <label>产品类型
            <input v-model="form.product_type" list="product-type-options" placeholder="如：压铸件" />
            <datalist id="product-type-options">
              <option v-for="t in types" :key="t" :value="t"></option>
            </datalist>
          </label>
          <label class="wide">说明<input v-model="form.description" placeholder="选填" /></label>
        </div>
      </div>

      <div class="prod-dialog-actions">
        <button class="prod-btn" @click="close">取消</button>
        <button class="prod-btn primary" :disabled="saving" @click="submit">{{ saving ? '保存中...' : '保存' }}</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue';
import { apiPost } from '../../shared/api';

const props = defineProps({
  visible: { type: Boolean, default: false },
  product: { type: Object, default: null },
  types: { type: Array, default: () => [] },
});

const emit = defineEmits(['close', 'saved']);

const emptyForm = () => ({
  product_name: '',
  product_code: '',
  product_type: '',
  description: '',
});

const form = ref(emptyForm());
const error = ref('');
const saving = ref(false);

const isEdit = computed(() => !!(props.product && props.product.id));

function fillForm() {
  if (props.product) {
    form.value = {
      product_name: props.product.product_name || '',
      product_code: props.product.product_code || '',
      product_type: props.product.product_type || '',
      description: props.product.description || '',
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
  if (!form.value.product_name.trim()) { error.value = '请填写产品名称'; return; }

  saving.value = true;
  try {
    if (isEdit.value) {
      await apiPost('/api/products/update', { id: props.product.id, ...form.value });
    } else {
      await apiPost('/api/products/create', form.value);
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
.prod-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9998;
  padding: 20px;
}
.prod-dialog {
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
.prod-dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid #24344a;
}
.prod-dialog-header h3 {
  margin: 0;
  font-size: 16px;
  color: #e6edf5;
}
.prod-close {
  background: none;
  border: none;
  color: #8ba3c7;
  font-size: 24px;
  line-height: 1;
  cursor: pointer;
}
.prod-close:hover { color: #e6edf5; }
.prod-dialog-body {
  padding: 16px 20px;
  overflow-y: auto;
}
.prod-message {
  margin-bottom: 12px;
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 13px;
  background: rgba(255, 77, 79, 0.12);
  color: #ff787e;
}
.prod-form {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px 16px;
}
.prod-form label {
  display: flex;
  flex-direction: column;
  gap: 5px;
  font-size: 12px;
  color: #8ba3c7;
}
.prod-form label i {
  color: #ff787e;
  font-style: normal;
}
.prod-form label.wide { grid-column: span 2; }
.prod-form input,
.prod-form select {
  background: #0d1420;
  border: 1px solid #2a3a52;
  border-radius: 6px;
  padding: 7px 10px;
  color: #e6edf5;
  font-size: 13px;
  outline: none;
}
.prod-form input:focus,
.prod-form select:focus { border-color: #3b82f6; }
.prod-dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 14px 20px;
  border-top: 1px solid #24344a;
}
.prod-btn {
  padding: 7px 18px;
  border: 1px solid #2a3a52;
  border-radius: 6px;
  background: #1d2b3e;
  color: #c8d6e8;
  font-size: 13px;
  cursor: pointer;
}
.prod-btn:hover { border-color: #3b82f6; }
.prod-btn.primary { background: #3b82f6; border-color: #3b82f6; color: #fff; }
.prod-btn.primary:hover { background: #2f6fe0; }
.prod-btn:disabled { opacity: 0.6; cursor: not-allowed; }
@media (max-width: 640px) {
  .prod-form { grid-template-columns: 1fr; }
  .prod-form label.wide { grid-column: span 1; }
}
</style>
