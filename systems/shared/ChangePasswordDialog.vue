<template>
  <div v-if="visible" class="pwd-overlay" @click.self="close">
    <div class="pwd-card">
      <div class="pwd-title">修改密码</div>
      <div class="pwd-body">
        <label class="pwd-field">
          <span>原密码</span>
          <input v-model="oldPassword" class="pwd-input" type="password" autocomplete="current-password" />
        </label>
        <label class="pwd-field">
          <span>新密码</span>
          <input v-model="newPassword" class="pwd-input" type="password" autocomplete="new-password" placeholder="至少 6 位" />
        </label>
        <label class="pwd-field">
          <span>确认新密码</span>
          <input v-model="confirmPassword" class="pwd-input" type="password" autocomplete="new-password" @keyup.enter="submit" />
        </label>
        <div v-if="error" class="pwd-error">{{ error }}</div>
        <div v-if="success" class="pwd-success">{{ success }}</div>
      </div>
      <div class="pwd-actions">
        <button class="pwd-btn cancel" @click="close">取消</button>
        <button class="pwd-btn confirm" :disabled="loading" @click="submit">{{ loading ? '提交中…' : '确定' }}</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, watch } from 'vue';
import { apiPost } from './api';

const props = defineProps({
  visible: { type: Boolean, default: false },
});

const emit = defineEmits(['close']);

const oldPassword = ref('');
const newPassword = ref('');
const confirmPassword = ref('');
const error = ref('');
const success = ref('');
const loading = ref(false);

watch(
  () => props.visible,
  (val) => {
    if (!val) return;
    oldPassword.value = '';
    newPassword.value = '';
    confirmPassword.value = '';
    error.value = '';
    success.value = '';
  }
);

async function submit() {
  if (loading.value) return;
  error.value = '';
  success.value = '';
  if (!oldPassword.value || !newPassword.value) {
    error.value = '请填写原密码与新密码';
    return;
  }
  if (newPassword.value.length < 6) {
    error.value = '新密码长度不能少于 6 位';
    return;
  }
  if (newPassword.value !== confirmPassword.value) {
    error.value = '两次输入的新密码不一致';
    return;
  }
  loading.value = true;
  try {
    await apiPost('/api/auth/password', {
      old_password: oldPassword.value,
      new_password: newPassword.value,
    });
    success.value = '密码已修改，其它终端的登录状态已失效';
    oldPassword.value = '';
    newPassword.value = '';
    confirmPassword.value = '';
    setTimeout(() => emit('close'), 1200);
  } catch (e) {
    error.value = e.message || '修改失败';
  } finally {
    loading.value = false;
  }
}

function close() {
  emit('close');
}
</script>

<style scoped>
.pwd-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.62);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10000;
}

.pwd-card {
  width: 360px;
  max-width: 92vw;
  background: #101a28;
  border: 1px solid #24344c;
  border-radius: 10px;
  padding: 20px;
  box-shadow: 0 12px 36px rgba(0, 0, 0, 0.5);
}

.pwd-title {
  font-size: 16px;
  font-weight: 600;
  color: #e6edf5;
  margin-bottom: 14px;
}

.pwd-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.pwd-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 12px;
  color: #8ba3c7;
}

.pwd-input {
  padding: 8px 12px;
  border: 1px solid #2a3a52;
  border-radius: 6px;
  background: #0b121d;
  color: #e6edf5;
  font-size: 14px;
  outline: none;
}

.pwd-input:focus {
  border-color: #3b82f6;
}

.pwd-error {
  color: #ff787e;
  font-size: 13px;
}

.pwd-success {
  color: #52c41a;
  font-size: 13px;
}

.pwd-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 18px;
}

.pwd-btn {
  padding: 6px 18px;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
}

.pwd-btn.cancel {
  background: #2a3a52;
  color: #a8b7cc;
}

.pwd-btn.confirm {
  background: #3b82f6;
  color: #fff;
}

.pwd-btn.confirm:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>
