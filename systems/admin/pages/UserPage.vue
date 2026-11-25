<template>
  <section class="page user-manage">
    <div class="dashboard-header">
      <h1 class="dashboard-title">用户权限</h1>
      <div v-if="can('user', 'create')" class="header-actions">
        <button class="refresh-btn" @click="openCreate">+ 新增用户</button>
      </div>
    </div>

    <div class="tech-data-container">
      <div class="data-toolbar">
        <span>共 <b>{{ loading ? '—' : users.length }}</b> 个账号</span>
        <span v-if="message" class="user-message">{{ message }}</span>
      </div>

      <div v-if="loading" class="page-hint">数据加载中…</div>

      <div class="table-scroll">
        <table class="data-table">
          <thead>
            <tr>
              <th class="idx-col">序号</th>
              <th>用户名</th>
              <th>显示名称</th>
              <th>角色</th>
              <th>看板页面</th>
              <th>后台页面</th>
              <th>按钮权限</th>
              <th>状态</th>
              <th>最近登录</th>
              <th style="width:190px;">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(u, idx) in users" :key="u.id">
              <td class="idx-col">{{ idx + 1 }}</td>
              <td class="code-cell">{{ u.username }}</td>
              <td>{{ u.display_name }}</td>
              <td>
                <span class="role-tag" :class="u.is_super ? 'super' : 'normal'">{{ u.is_super ? '超级管理员' : '普通用户' }}</span>
              </td>
              <td>{{ u.is_super ? '全部' : (u.display_pages || []).length }}</td>
              <td>{{ u.is_super ? '全部' : (u.admin_pages || []).length }}</td>
              <td>{{ u.is_super ? '全部' : (u.actions || []).length }}</td>
              <td>
                <span class="active-tag" :class="Number(u.is_active) === 1 ? 'on' : 'off'">
                  {{ Number(u.is_active) === 1 ? '启用' : '停用' }}
                </span>
              </td>
              <td class="time-cell">{{ u.last_login_at || '--' }}</td>
              <td>
                <button v-if="can('user', 'update')" class="link-btn" @click="openEdit(u)">编辑</button>
                <button v-if="can('user', 'update')" class="link-btn" @click="openReset(u)">重置密码</button>
                <button
                  v-if="can('user', 'delete') && (!currentUserId || u.id !== currentUserId)"
                  class="link-btn danger"
                  @click="askDelete(u)"
                >删除</button>
              </td>
            </tr>
            <tr v-if="!users.length">
              <td colspan="10" style="text-align:center;color:var(--text-secondary);padding:30px 0;">暂无账号</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <UserEditDialog :visible="dialogVisible" :user="editingUser" @close="dialogVisible = false" @saved="onSaved" />

    <AppDialog
      :visible="resetState.visible"
      title="重置密码"
      message="请输入新密码（至少 6 位），保存后该账号的其它登录会话将失效。"
      mode="input"
      placeholder="新密码"
      @confirm="handleReset"
      @cancel="resetState.visible = false"
    />

    <AppDialog
      :visible="confirmState.visible"
      title="删除用户"
      :message="confirmState.message"
      mode="confirm"
      @confirm="handleConfirm"
      @cancel="confirmState.visible = false"
    />
  </section>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { apiGet, apiPost } from '../../shared/api';
import { authState, can } from '../../shared/auth';
import UserEditDialog from './UserEditDialog.vue';
import AppDialog from '../../shared/AppDialog.vue';

const props = defineProps({
  active: { type: Boolean, default: false },
});

const users = ref([]);
const loading = ref(false);
const message = ref('');
const dialogVisible = ref(false);
const editingUser = ref(null);
const resetState = ref({ visible: false, user: null });
const confirmState = ref({ visible: false, message: '', user: null });

const currentUserId = computed(() => (authState.user ? authState.user.id : null));

function flash(text) {
  message.value = text;
  setTimeout(() => {
    if (message.value === text) message.value = '';
  }, 4000);
}

async function loadUsers() {
  loading.value = true;
  try {
    const data = await apiGet('/api/auth/users');
    users.value = data.users || [];
  } catch (e) {
    users.value = [];
    flash(`加载失败：${e.message}`);
  } finally {
    loading.value = false;
  }
}

function openCreate() {
  editingUser.value = null;
  dialogVisible.value = true;
}

function openEdit(user) {
  editingUser.value = user;
  dialogVisible.value = true;
}

function openReset(user) {
  resetState.value = { visible: true, user };
}

async function handleReset(value) {
  const user = resetState.value.user;
  resetState.value.visible = false;
  const password = String(value || '');
  if (!user) return;
  if (password.length < 6) {
    flash('密码长度不能少于 6 位');
    return;
  }
  try {
    await apiPost('/api/auth/users/update', { id: user.id, password });
    flash(`已重置【${user.username}】的密码`);
    loadUsers();
  } catch (e) {
    flash(e.message || '重置失败');
  }
}

function onSaved() {
  flash('账号信息已保存');
  loadUsers();
}

function askDelete(user) {
  confirmState.value = {
    visible: true,
    user,
    message: `确定删除账号【${user.username}】？删除后该账号立即无法登录。`,
  };
}

async function handleConfirm() {
  const user = confirmState.value.user;
  confirmState.value.visible = false;
  if (!user) return;
  try {
    await apiPost('/api/auth/users/delete', { id: user.id });
    flash(`账号【${user.username}】已删除`);
    loadUsers();
  } catch (e) {
    flash(e.message || '删除失败');
  }
}

watch(
  () => props.active,
  (val) => {
    if (val) loadUsers();
  }
);

onMounted(() => {
  if (props.active) loadUsers();
});
</script>

<style scoped>
.header-actions {
  display: flex;
  gap: 12px;
}

.user-message {
  color: #40a9ff;
  font-size: 12px;
}

.code-cell {
  font-family: 'Courier New', monospace;
  color: #40a9ff;
}

.time-cell {
  font-size: 12px;
  color: #8ba3c7;
}

.role-tag {
  display: inline-block;
  padding: 1px 10px;
  border-radius: 10px;
  font-size: 12px;
}

.role-tag.super {
  background: rgba(250, 173, 20, 0.16);
  color: #faad14;
}

.role-tag.normal {
  background: rgba(24, 144, 255, 0.14);
  color: #40a9ff;
}

.active-tag {
  display: inline-block;
  padding: 1px 10px;
  border-radius: 10px;
  font-size: 12px;
}

.active-tag.on {
  background: rgba(82, 196, 26, 0.15);
  color: #52c41a;
}

.active-tag.off {
  background: rgba(140, 155, 175, 0.15);
  color: #8ba3c7;
}

.link-btn {
  background: none;
  border: none;
  color: #40a9ff;
  font-size: 13px;
  cursor: pointer;
  padding: 2px 6px;
}

.link-btn:hover {
  text-decoration: underline;
}

.link-btn.danger {
  color: #ff787e;
}
</style>
