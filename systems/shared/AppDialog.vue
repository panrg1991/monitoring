<template>
  <div class="app-dialog-overlay" v-if="visible" @click.self="handleCancel">
    <div class="app-dialog">
      <div class="app-dialog-title">{{ title }}</div>
      <div class="app-dialog-body">
        <p v-if="message" class="app-dialog-msg">{{ message }}</p>
        <input
          v-if="mode === 'input'"
          v-model="inputValue"
          class="app-dialog-input"
          :placeholder="placeholder"
          @keyup.enter="handleConfirm"
          autofocus
        />
      </div>
      <div class="app-dialog-actions">
        <button v-if="mode !== 'alert'" class="dialog-btn cancel" @click="handleCancel">取消</button>
        <button class="dialog-btn confirm" @click="handleConfirm">确定</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, watch } from 'vue';

const props = defineProps({
  visible: { type: Boolean, default: false },
  title: { type: String, default: '提示' },
  message: { type: String, default: '' },
  mode: { type: String, default: 'confirm' }, // 'confirm' | 'input' | 'alert'
  placeholder: { type: String, default: '' },
});

const emit = defineEmits(['confirm', 'cancel', 'update:visible']);

const inputValue = ref('');

watch(
  () => props.visible,
  (val) => {
    if (val) inputValue.value = '';
  }
);

function handleConfirm() {
  if (props.mode === 'input') {
    emit('confirm', inputValue.value);
  } else {
    emit('confirm');
  }
}

function handleCancel() {
  emit('cancel');
  emit('update:visible', false);
}
</script>

<style scoped>
.app-dialog-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
}
.app-dialog {
  background: #16202e;
  border: 1px solid #2a3a52;
  border-radius: 10px;
  width: 360px;
  max-width: 90vw;
  padding: 20px;
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.5);
}
.app-dialog-title {
  font-size: 16px;
  font-weight: 600;
  color: #e6edf5;
  margin-bottom: 14px;
}
.app-dialog-msg {
  font-size: 14px;
  color: #a8b7cc;
  margin: 0 0 6px;
  line-height: 1.5;
  word-break: break-all;
}
.app-dialog-input {
  width: 100%;
  box-sizing: border-box;
  padding: 8px 12px;
  border: 1px solid #2a3a52;
  border-radius: 6px;
  background: #0d1420;
  color: #e6edf5;
  font-size: 14px;
  outline: none;
  margin-top: 6px;
}
.app-dialog-input:focus {
  border-color: #3b82f6;
}
.app-dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 18px;
}
.dialog-btn {
  padding: 6px 18px;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
}
.dialog-btn.cancel {
  background: #2a3a52;
  color: #a8b7cc;
}
.dialog-btn.cancel:hover {
  background: #3a4a62;
}
.dialog-btn.confirm {
  background: #3b82f6;
  color: #fff;
}
.dialog-btn.confirm:hover {
  background: #2f6fe0;
}
</style>
