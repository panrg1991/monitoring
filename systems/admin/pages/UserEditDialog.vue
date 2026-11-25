<template>
  <div v-if="visible" class="user-dialog-overlay" @click.self="close">
    <div class="user-dialog">
      <div class="user-dialog-head">
        <span>{{ isEdit ? '编辑用户' : '新增用户' }}</span>
        <button class="user-dialog-close" @click="close">×</button>
      </div>

      <div class="user-dialog-body">
        <div class="form-row">
          <label class="form-label">用户名 <i>*</i></label>
          <input v-model.trim="form.username" class="form-input" :disabled="isEdit && form.is_super" placeholder="字母/数字/下划线，3-32 位" />
        </div>
        <div class="form-row">
          <label class="form-label">显示名称</label>
          <input v-model.trim="form.display_name" class="form-input" placeholder="车间看板右上角的显示名" />
        </div>
        <div class="form-row">
          <label class="form-label">{{ isEdit ? '重置密码' : '初始密码' }}</label>
          <input
            v-model="form.password"
            class="form-input"
            type="text"
            :placeholder="isEdit ? '留空表示不修改（至少 6 位）' : '默认 123456'"
          />
        </div>
        <div class="form-row form-row-inline">
          <label class="form-check">
            <input v-model="form.is_active" type="checkbox" :disabled="isEdit && form.is_super && form.is_self" />
            <span>启用账号</span>
          </label>
          <label v-if="canSetSuper" class="form-check">
            <input v-model="form.role_super" type="checkbox" :disabled="form.is_self" />
            <span>超级管理员（拥有全部权限）</span>
          </label>
        </div>
        <div v-if="form.role_super" class="form-hint">
          超级管理员自动拥有全部看板页面、后台页面与按钮权限，无需单独勾选。
        </div>

        <template v-else>
          <div class="perm-section">
            <div class="perm-title">可查看的车间看板</div>
            <div class="perm-grid">
              <label v-for="p in meta.display_pages" :key="p.key" class="form-check">
                <input v-model="form.display_pages" type="checkbox" :value="p.key" />
                <span>{{ p.label }}</span>
              </label>
            </div>
          </div>

          <div class="perm-section">
            <div class="perm-title">可进入的后台管理页面</div>
            <div class="perm-grid">
              <label v-for="p in meta.admin_pages" :key="p.key" class="form-check">
                <input v-model="form.admin_pages" type="checkbox" :value="p.key" :disabled="p.key === 'user' && !canSetSuper" />
                <span>{{ p.label }}</span>
              </label>
            </div>
          </div>

          <div class="perm-section">
            <div class="perm-title">按钮操作权限</div>
            <div class="perm-hint">按钮权限依附于所属模块页面：未分配该模块页面时，其下按钮不可分配（已勾选的会被自动取消）。</div>
            <div
              v-for="group in meta.actions"
              :key="group.key"
              class="action-group"
              :class="{ 'action-group-disabled': !isGroupAllowed(group.key) }"
            >
              <div class="action-group-name">
                {{ group.label }}
                <span v-if="!isGroupAllowed(group.key)" class="action-group-tip">
                  未分配「{{ moduleLabel(group.key) }}」页面，需先勾选该页面
                </span>
              </div>
              <div class="perm-grid">
                <label v-for="a in group.actions" :key="a.key" class="form-check">
                  <input
                    v-model="form.actions"
                    type="checkbox"
                    :value="`${group.key}:${a.key}`"
                    :disabled="!isGroupAllowed(group.key) || (group.key === 'user' && !canSetSuper)"
                  />
                  <span>{{ a.label }}</span>
                </label>
              </div>
            </div>
          </div>
        </template>

        <div v-if="error" class="form-error">{{ error }}</div>
      </div>

      <div class="user-dialog-actions">
        <button class="dialog-btn cancel" @click="close">取消</button>
        <button class="dialog-btn confirm" :disabled="saving" @click="submit">{{ saving ? '保存中…' : '保存' }}</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, reactive, ref, watch } from 'vue';
import { apiPost } from '../../shared/api';
import { authState, isSuper } from '../../shared/auth';

const props = defineProps({
  visible: { type: Boolean, default: false },
  user: { type: Object, default: null },
});

const emit = defineEmits(['close', 'saved']);

const meta = computed(() => authState.meta || { display_pages: [], admin_pages: [], actions: [] });
const canSetSuper = computed(() => isSuper());
const isEdit = computed(() => !!(props.user && props.user.id));

const form = reactive({
  username: '',
  display_name: '',
  password: '',
  is_active: true,
  role_super: false,
  is_super: false,
  is_self: false,
  display_pages: [],
  admin_pages: [],
  actions: [],
});

const error = ref('');
const saving = ref(false);

// 动作分组 key 与页面 key 一致：拥有该模块任一端页面后，其下按钮才可分配
const moduleLabels = computed(() => {
  const map = {};
  [...(meta.value.display_pages || []), ...(meta.value.admin_pages || [])].forEach((p) => {
    map[p.key] = p.label;
  });
  (meta.value.actions || []).forEach((g) => {
    if (!map[g.key]) map[g.key] = g.label;
  });
  return map;
});

const allowedModules = computed(() => new Set([...(form.display_pages || []), ...(form.admin_pages || [])]));

function moduleLabel(key) {
  return moduleLabels.value[key] || key;
}

function isGroupAllowed(key) {
  if (form.role_super) return true;
  return allowedModules.value.has(key);
}

// 取消页面时立即回收该模块下的按钮勾选
watch(
  () => [...form.display_pages, ...form.admin_pages],
  () => {
    const allowed = new Set([...form.display_pages, ...form.admin_pages]);
    form.actions = form.actions.filter((key) => allowed.has(String(key).split(':')[0]));
  }
);

watch(
  () => props.visible,
  (val) => {
    if (!val) return;
    error.value = '';
    saving.value = false;
    const u = props.user;
    form.username = u ? u.username : '';
    form.display_name = u ? u.display_name : '';
    form.password = '';
    form.is_active = u ? Number(u.is_active) === 1 : true;
    form.role_super = u ? !!u.is_super : false;
    form.is_super = u ? !!u.is_super : false;
    form.is_self = !!(u && authState.user && u.id === authState.user.id);
    form.display_pages = u ? [...(u.display_pages || [])] : ['home'];
    form.admin_pages = u ? [...(u.admin_pages || [])] : [];
    form.actions = u ? [...(u.actions || [])] : [];
  }
);

async function submit() {
  if (saving.value) return;
  error.value = '';
  if (!form.username) {
    error.value = '请填写用户名';
    return;
  }
  if (!isEdit.value && !form.password) {
    error.value = '请设置初始密码';
    return;
  }
  if (form.password && (form.password.length < 6 || form.password.length > 128)) {
    error.value = '密码长度需在 6 ~ 128 位之间';
    return;
  }

  // 只提交「拥有对应页面」的动作，避免保存悬空授权
  const allowed = new Set([...form.display_pages, ...form.admin_pages]);
  const actions = form.actions.filter((key) => allowed.has(String(key).split(':')[0]));

  const payload = {
    username: form.username,
    display_name: form.display_name,
    is_active: form.is_active ? 1 : 0,
    role: form.role_super ? 'super' : 'normal',
    display_pages: form.role_super ? [] : form.display_pages,
    admin_pages: form.role_super ? [] : form.admin_pages,
    actions: form.role_super ? [] : actions,
  };
  if (form.password) payload.password = form.password;
  if (isEdit.value) payload.id = props.user.id;

  saving.value = true;
  try {
    await apiPost(isEdit.value ? '/api/auth/users/update' : '/api/auth/users/create', payload);
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
.user-dialog-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.62);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10000;
}

.user-dialog {
  width: 720px;
  max-width: 94vw;
  max-height: 88vh;
  display: flex;
  flex-direction: column;
  background: #101a28;
  border: 1px solid #24344c;
  border-radius: 10px;
  box-shadow: 0 16px 42px rgba(0, 0, 0, 0.55);
}

.user-dialog-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 18px;
  border-bottom: 1px solid #1e2c40;
  font-size: 15px;
  font-weight: 600;
  color: #e6edf5;
}

.user-dialog-close {
  background: none;
  border: none;
  color: #7d90a8;
  font-size: 20px;
  cursor: pointer;
  line-height: 1;
}

.user-dialog-body {
  padding: 16px 18px;
  overflow-y: auto;
}

.form-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}

.form-row-inline {
  gap: 26px;
}

.form-label {
  width: 92px;
  flex: none;
  font-size: 13px;
  color: #8ba3c7;
}

.form-label i {
  color: #ff787e;
  font-style: normal;
}

.form-input {
  flex: 1;
  min-width: 0;
  padding: 7px 10px;
  border: 1px solid #2a3a52;
  border-radius: 6px;
  background: #0b121d;
  color: #e6edf5;
  font-size: 13px;
  outline: none;
}

.form-input:focus {
  border-color: #3b82f6;
}

.form-check {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: #a8b7cc;
  cursor: pointer;
  user-select: none;
}

.form-check input {
  cursor: pointer;
}

.form-hint {
  padding: 8px 10px;
  border-radius: 6px;
  background: rgba(24, 144, 255, 0.08);
  border: 1px solid rgba(24, 144, 255, 0.25);
  color: #40a9ff;
  font-size: 12px;
  margin-bottom: 8px;
}

.perm-section {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px dashed #1e2c40;
}

.perm-title {
  font-size: 13px;
  color: #d3dfec;
  margin-bottom: 8px;
}

.perm-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 22px;
}

.action-group {
  margin-bottom: 8px;
}

.action-group-disabled {
  opacity: 0.62;
}

.action-group-name {
  font-size: 12px;
  color: #7d90a8;
  margin-bottom: 4px;
}

.action-group-tip {
  margin-left: 8px;
  color: #faad14;
  font-size: 11px;
}

.perm-hint {
  margin-bottom: 8px;
  padding: 6px 10px;
  border-radius: 6px;
  background: rgba(250, 173, 20, 0.08);
  border: 1px solid rgba(250, 173, 20, 0.22);
  color: #d8b26a;
  font-size: 12px;
  line-height: 1.5;
}

.form-error {
  margin-top: 10px;
  color: #ff787e;
  font-size: 13px;
}

.user-dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 12px 18px;
  border-top: 1px solid #1e2c40;
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

.dialog-btn.confirm {
  background: #3b82f6;
  color: #fff;
}

.dialog-btn.confirm:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>
