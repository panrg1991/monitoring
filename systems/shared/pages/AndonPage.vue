<template>
  <section class="page andon">
    <div class="dashboard-header">
      <h1 class="dashboard-title">安灯呼叫中心</h1>
    </div>

    <div class="andon-container">
      <div class="module-title">快捷呼叫</div>
      <div v-if="can('andon', 'create')" class="andon-grid">
        <div
          v-for="t in andonTypes"
          :key="t.id"
          class="andon-btn"
          :class="'btn-type-' + (t.type_key || 'other')"
          @click="openCallerDialog(t)"
        >
          <span class="btn-icon" v-html="typeIcon(t)"></span>
          <span class="btn-text">{{ t.type_name }}</span>
          <span class="btn-desc">{{ t.type_desc || '点击呼叫' }}</span>
        </div>
      </div>

      <div v-if="!can('andon', 'create')" class="module-title" style="color:var(--text-secondary);font-weight:400;font-size:13px;">
        当前账号没有发起呼叫权限，可查看呼叫记录
      </div>

      <div v-if="can('andon', 'create')" class="custom-call-section">
        <h3>自定义呼叫</h3>
        <div class="custom-input-row">
          <input v-model="customCall.type" placeholder="呼叫类型（如：设备故障）" />
          <input v-model="customCall.detail" placeholder="呼叫详情（如：3号压铸机报警）" @keyup.enter="submitCustomCall" />
          <button class="btn-submit-custom" @click="submitCustomCall">发起呼叫</button>
        </div>
      </div>

      <div class="call-records">
        <h3>呼叫记录</h3>
        <div class="table-scroll">
        <table class="record-table">
          <thead>
            <tr>
              <th class="idx-col">序号</th>
              <th>呼叫类型</th>
              <th>呼叫内容</th>
              <th>状态</th>
              <th>发起人</th>
              <th>呼叫时间</th>
              <th>处理人</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(c, idx) in andonCalls" :key="c.id">
              <td class="idx-col">{{ idx + 1 }}</td>
              <td>{{ c.call_type }}</td>
              <td>{{ c.call_detail }}</td>
              <td>
                <span class="record-status" :class="c.status">{{ andonStatusText(c.status) }}</span>
              </td>
              <td>{{ c.caller || '--' }}</td>
              <td>{{ c.call_time }}</td>
              <td>{{ c.handler || '--' }}</td>
              <td>
                <template v-if="isAdmin && can('andon', 'respond')">
                  <button v-if="c.status === 'pending'" class="btn-action" @click="openRespondDialog(c)">响应</button>
                  <button v-else-if="c.status === 'processing'" class="btn-action btn-action-complete" @click="openCompleteDialog(c)">完成</button>
                  <span v-else style="color:var(--text-secondary);font-size:12px;">--</span>
                </template>
                <span v-else style="color:var(--text-secondary);font-size:12px;">--</span>
              </td>
            </tr>
            <tr v-if="!andonCalls.length">
              <td colspan="8" style="text-align:center;color:var(--text-secondary);">暂无呼叫记录</td>
            </tr>
          </tbody>
        </table>
        </div>
      </div>

      <div class="call-records" style="margin-top:20px;">
        <h3>操作日志</h3>
        <div class="table-scroll">
        <table class="record-table">
          <thead>
            <tr>
              <th class="idx-col">序号</th>
              <th>操作时间</th>
              <th>呼叫类型</th>
              <th>操作</th>
              <th>操作人</th>
              <th>内容</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(l, idx) in andonLogs" :key="l.id">
              <td class="idx-col">{{ idx + 1 }}</td>
              <td>{{ l.operate_time }}</td>
              <td>{{ l.call_type || '--' }}</td>
              <td>
                <span class="log-action" :class="'log-' + (l.action || 'create')">{{ logActionText(l.action) }}</span>
              </td>
              <td>{{ l.operator || '--' }}</td>
              <td>{{ l.content }}</td>
            </tr>
            <tr v-if="!andonLogs.length">
              <td colspan="6" style="text-align:center;color:var(--text-secondary);">暂无操作日志</td>
            </tr>
          </tbody>
        </table>
        </div>
      </div>
    </div>

    <!-- 通用弹窗：替代原生 prompt / alert -->
    <AppDialog
      v-model:visible="dialogVisible"
      :title="dialogTitle"
      :message="dialogMessage"
      :mode="dialogMode"
      :placeholder="dialogPlaceholder"
      @confirm="onDialogConfirm"
    />
  </section>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue';
import { apiGet, apiPost, escapeHtml } from '../api';
import { can } from '../auth';
import AppDialog from '../AppDialog.vue';

const props = defineProps({
  active: { type: Boolean, default: false },
  // display = 前端显示系统（看板，不处理呼叫）；admin = 后端管理系统（可响应 / 完成）
  viewMode: { type: String, default: 'admin' },
});

const isAdmin = computed(() => props.viewMode !== 'display');

const andonTypes = ref([]);
const andonCalls = ref([]);
const andonLogs = ref([]);
const customCall = ref({ type: '', detail: '' });

// 弹窗状态
const dialogVisible = ref(false);
const dialogTitle = ref('提示');
const dialogMessage = ref('');
const dialogMode = ref('input'); // 'input' | 'confirm' | 'alert'
const dialogPlaceholder = ref('');
let dialogResolve = null; // 用于 input/confirm 的 Promise 结果

function openDialog({ title = '提示', message = '', mode = 'confirm', placeholder = '' }) {
  return new Promise((resolve) => {
    dialogTitle.value = title;
    dialogMessage.value = message;
    dialogMode.value = mode;
    dialogPlaceholder.value = placeholder;
    dialogVisible.value = true;
    dialogResolve = resolve;
  });
}

function onDialogConfirm(value) {
  dialogVisible.value = false;
  if (dialogResolve) {
    const r = dialogMode.value === 'input' ? value : true;
    dialogResolve(r);
    dialogResolve = null;
  }
}

function typeIcon(t) {
  if (t.type_icon) return escapeHtml(t.type_icon);
  const map = {
    quality: '&#11088;',
    device: '&#9888;',
    material: '&#128230;',
    safety: '&#128737;',
    tool: '&#128295;',
    other: '&#128203;',
  };
  return map[t.type_key] || '&#128203;';
}

function andonStatusText(s) {
  return s === 'pending' ? '待响应' : s === 'processing' ? '处理中' : '已完成';
}

function logActionText(action) {
  const map = { create: '发起', respond: '响应', complete: '完成', cancel: '取消' };
  return map[action] || action || '发起';
}

async function loadAndonData() {
  try {
    const [types, calls, logs] = await Promise.all([
      apiGet('/api/andon/types'),
      apiGet('/api/andon/calls'),
      apiGet('/api/andon/logs'),
    ]);
    andonTypes.value = types || [];
    andonCalls.value = calls || [];
    andonLogs.value = logs || [];
  } catch (e) {
    console.error('加载安灯数据失败', e);
  }
}

// 快捷呼叫：弹窗输入呼叫人
async function openCallerDialog(type) {
  const caller = await openDialog({
    title: '发起呼叫',
    message: `呼叫类型：${type.type_name}。请输入呼叫人（可选）：`,
    mode: 'input',
    placeholder: '请输入呼叫人',
  });
  if (caller === false) return;
  try {
    await apiPost('/api/andon/call', {
      call_type: type.type_key || type.type_name,
      call_detail: type.type_name,
      caller: caller || '系统自动',
    });
    await openDialog({ title: '提示', message: '呼叫已发出', mode: 'alert' });
    loadAndonData();
  } catch (e) {
    await openDialog({ title: '错误', message: '呼叫失败：' + e.message, mode: 'alert' });
  }
}

async function submitCustomCall() {
  if (!customCall.value.type || !customCall.value.detail) {
    await openDialog({ title: '提示', message: '请填写呼叫类型和呼叫内容', mode: 'alert' });
    return;
  }
  const caller = await openDialog({
    title: '发起呼叫',
    message: `呼叫类型：${customCall.value.type}。请输入呼叫人（可选）：`,
    mode: 'input',
    placeholder: '请输入呼叫人',
  });
  if (caller === false) return;
  try {
    await apiPost('/api/andon/call', {
      call_type: customCall.value.type,
      call_detail: customCall.value.detail,
      caller: caller || '系统自动',
    });
    await openDialog({ title: '提示', message: '呼叫已发出', mode: 'alert' });
    customCall.value = { type: '', detail: '' };
    loadAndonData();
  } catch (e) {
    await openDialog({ title: '错误', message: '呼叫失败：' + e.message, mode: 'alert' });
  }
}

async function openRespondDialog(call) {
  const handler = await openDialog({
    title: '响应呼叫',
    message: `呼叫：${call.call_type} - ${call.call_detail}\n请输入处理人：`,
    mode: 'input',
    placeholder: '请输入处理人',
  });
  if (handler === false) return;
  try {
    await apiPost('/api/andon/respond', { id: call.id, handler: handler || '未指定' });
    await openDialog({ title: '提示', message: '已响应', mode: 'alert' });
    loadAndonData();
  } catch (e) {
    await openDialog({ title: '错误', message: '响应失败：' + e.message, mode: 'alert' });
  }
}

async function openCompleteDialog(call) {
  const remark = await openDialog({
    title: '完成呼叫',
    message: `呼叫：${call.call_type} - ${call.call_detail}\n请输入处理备注：`,
    mode: 'input',
    placeholder: '请输入处理备注',
  });
  if (remark === false) return;
  try {
    await apiPost('/api/andon/complete', { id: call.id, handle_remark: remark || '已处理', operator: call.handler || '' });
    await openDialog({ title: '提示', message: '已完成', mode: 'alert' });
    loadAndonData();
  } catch (e) {
    await openDialog({ title: '错误', message: '完成失败：' + e.message, mode: 'alert' });
  }
}

watch(
  () => props.active,
  (val) => {
    if (val) loadAndonData();
  }
);

onMounted(() => {
  if (props.active) loadAndonData();
});
</script>
