<template>
  <div v-if="visible" class="login-layer" :class="{ 'login-page-mode': mode === 'page' }" @click.self="handleClose">
    <div class="login-card">
      <div class="login-head">
        <div class="login-logo">{{ mode === 'page' ? '\u2699' : '\u2696' }}</div>
        <div class="login-title">{{ title }}</div>
        <div class="login-sub">{{ subtitle }}</div>
      </div>

      <form class="login-form" @submit.prevent="submit">
        <label class="login-field">
          <span class="login-label">用户名</span>
          <input
            ref="usernameInput"
            v-model.trim="username"
            class="login-input"
            type="text"
            autocomplete="username"
            placeholder="请输入用户名"
            @keyup.enter="submit"
          />
        </label>
        <label class="login-field">
          <span class="login-label">密码</span>
          <input
            v-model="password"
            class="login-input"
            type="password"
            autocomplete="current-password"
            placeholder="请输入密码"
            @keyup.enter="submit"
          />
        </label>

        <div v-if="error" class="login-error">{{ error }}</div>

        <button class="login-submit" type="submit" :disabled="loading">
          {{ loading ? '登录中…' : '登 录' }}
        </button>
        <button v-if="mode !== 'page'" type="button" class="login-cancel" @click="handleClose">取消</button>
      </form>

      <div v-if="mode === 'page'" class="login-foot">
        <a class="login-link" href="/">返回车间看板</a>
      </div>
    </div>
  </div>
</template>

<script setup>
import { nextTick, ref, watch } from 'vue';
import { login } from './auth';

const props = defineProps({
  visible: { type: Boolean, default: false },
  // modal：看板右上角弹窗；page：后台整页登录
  mode: { type: String, default: 'modal' },
});

const emit = defineEmits(['close', 'logged-in']);

const username = ref('');
const password = ref('');
const error = ref('');
const loading = ref(false);
const usernameInput = ref(null);

watch(
  () => props.visible,
  async (val) => {
    if (!val) return;
    error.value = '';
    password.value = '';
    await nextTick();
    if (usernameInput.value) usernameInput.value.focus();
  }
);

async function submit() {
  if (loading.value) return;
  error.value = '';
  if (!username.value || !password.value) {
    error.value = '请输入用户名和密码';
    return;
  }
  loading.value = true;
  try {
    const user = await login(username.value, password.value);
    password.value = '';
    emit('logged-in', user);
    emit('close');
  } catch (e) {
    error.value = e.message || '登录失败';
  } finally {
    loading.value = false;
  }
}

function handleClose() {
  emit('close');
}
</script>

<style scoped>
.login-layer {
  position: fixed;
  inset: 0;
  background: rgba(4, 8, 15, 0.78);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10000;
  backdrop-filter: blur(3px);
}

.login-layer.login-page-mode {
  background: radial-gradient(circle at 50% 20%, #132033 0%, #070c14 70%);
}

.login-card {
  width: 360px;
  max-width: 92vw;
  background: #101a28;
  border: 1px solid #24344c;
  border-radius: 12px;
  padding: 26px 24px 22px;
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.55);
}

.login-head {
  text-align: center;
  margin-bottom: 20px;
}

.login-logo {
  font-size: 30px;
  line-height: 1;
  color: #3b82f6;
  margin-bottom: 8px;
}

.login-title {
  font-size: 18px;
  font-weight: 600;
  color: #e6edf5;
  letter-spacing: 1px;
}

.login-sub {
  margin-top: 6px;
  font-size: 12px;
  color: #7d90a8;
}

.login-form {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.login-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.login-label {
  font-size: 12px;
  color: #8ba3c7;
}

.login-input {
  width: 100%;
  box-sizing: border-box;
  padding: 9px 12px;
  border: 1px solid #2a3a52;
  border-radius: 6px;
  background: #0b121d;
  color: #e6edf5;
  font-size: 14px;
  outline: none;
  transition: border-color 0.15s ease;
}

.login-input:focus {
  border-color: #3b82f6;
}

.login-error {
  padding: 8px 10px;
  border-radius: 6px;
  background: rgba(255, 77, 79, 0.12);
  border: 1px solid rgba(255, 77, 79, 0.35);
  color: #ff787e;
  font-size: 13px;
  line-height: 1.4;
  word-break: break-all;
}

.login-submit {
  margin-top: 4px;
  padding: 10px 0;
  border: none;
  border-radius: 6px;
  background: #3b82f6;
  color: #fff;
  font-size: 15px;
  letter-spacing: 4px;
  cursor: pointer;
  transition: background 0.15s ease;
}

.login-submit:hover:not(:disabled) {
  background: #2f6fe0;
}

.login-submit:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.login-cancel {
  background: none;
  border: none;
  color: #7d90a8;
  font-size: 13px;
  cursor: pointer;
  padding: 2px;
}

.login-cancel:hover {
  color: #a8b7cc;
}

.login-foot {
  margin-top: 16px;
  text-align: center;
}

.login-link {
  font-size: 12px;
  color: #40a9ff;
  text-decoration: none;
}

.login-link:hover {
  text-decoration: underline;
}
</style>
