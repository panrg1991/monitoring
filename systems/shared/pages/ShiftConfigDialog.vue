<template>
  <div class="shift-overlay" v-if="visible" @click.self="close">
    <div class="shift-dialog">
      <div class="shift-header">
        <div>
          <h3>班次设置</h3>
        </div>
        <button class="shift-close" @click="close">&times;</button>
      </div>

      <div class="shift-body">
        <div class="shift-message" v-if="message" :class="messageType">{{ message }}</div>

        <div class="shift-toolbar">
          <button class="shift-btn primary" @click="initDefault">一键生成白班 / 夜班</button>
          <span class="shift-mode">
            当前模式：{{ activeCount ? `按班次统计（${activeCount} 个班次）` : '按天统计' }}
          </span>
        </div>

        <div class="table-scroll">
        <table class="shift-table">
          <thead>
            <tr>
              <th style="width:150px;">班次名称</th>
              <th style="width:110px;">编码</th>
              <th style="width:100px;">开始</th>
              <th style="width:100px;">结束</th>
              <th style="width:80px;">排序</th>
              <th style="width:80px;">启用</th>
              <th style="width:130px;">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="s in rows" :key="s.id">
              <td><input v-model="s.shift_name" /></td>
              <td><input v-model="s.shift_code" /></td>
              <td><input v-model="s.start_time" type="time" /></td>
              <td><input v-model="s.end_time" type="time" /></td>
              <td><input v-model.number="s.sort_order" type="number" /></td>
              <td>
                <select v-model.number="s.is_active">
                  <option :value="1">启用</option>
                  <option :value="0">停用</option>
                </select>
              </td>
              <td>
                <button class="shift-btn small primary" @click="save(s)">保存</button>
                <button class="shift-btn small danger" @click="remove(s)">删除</button>
              </td>
            </tr>
            <tr v-if="!rows.length">
              <td colspan="7" class="shift-empty">尚未配置班次，当前按天统计</td>
            </tr>
          </tbody>
        </table>
        </div>

        <div class="shift-add">
          <label>名称<input v-model="addForm.shift_name" placeholder="如：白班" /></label>
          <label>开始<input v-model="addForm.start_time" type="time" /></label>
          <label>结束<input v-model="addForm.end_time" type="time" /></label>
          <button class="shift-btn primary" :disabled="!canAdd" @click="create">新增班次</button>
        </div>
      </div>
    </div>

    <AppDialog
      :visible="confirmState.visible"
      title="删除班次"
      :message="confirmState.message"
      mode="confirm"
      @confirm="handleConfirm"
      @cancel="confirmState.visible = false"
    />
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue';
import { apiPost } from '../api';
import AppDialog from '../AppDialog.vue';

const props = defineProps({
  visible: { type: Boolean, default: false },
  shifts: { type: Array, default: () => [] },
});

const emit = defineEmits(['close', 'changed']);

const rows = ref([]);
const message = ref('');
const messageType = ref('ok');
const addForm = ref({ shift_name: '', start_time: '08:00', end_time: '20:00' });
const confirmState = ref({ visible: false, message: '', shift: null });

const activeCount = computed(() => rows.value.filter((r) => Number(r.is_active) === 1).length);
const canAdd = computed(() => !!addForm.value.shift_name.trim() && !!addForm.value.start_time && !!addForm.value.end_time);

function flash(text, type = 'ok') {
  message.value = text;
  messageType.value = type;
  setTimeout(() => { if (message.value === text) message.value = ''; }, 3000);
}

function loadRows() {
  rows.value = (props.shifts || []).map((s) => ({ ...s }));
}

watch(() => props.visible, (val) => {
  if (val) {
    message.value = '';
    addForm.value = { shift_name: '', start_time: '08:00', end_time: '20:00' };
    loadRows();
  }
});

watch(() => props.shifts, loadRows, { deep: true });

async function create() {
  try {
    await apiPost('/api/stats/shifts/create', addForm.value);
    flash(`班次【${addForm.value.shift_name}】已新增`);
    addForm.value = { shift_name: '', start_time: '08:00', end_time: '20:00' };
    emit('changed');
  } catch (e) {
    flash(e.message || '新增失败', 'err');
  }
}

async function save(row) {
  try {
    await apiPost('/api/stats/shifts/update', {
      id: row.id,
      shift_name: row.shift_name,
      shift_code: row.shift_code,
      start_time: row.start_time,
      end_time: row.end_time,
      sort_order: row.sort_order,
      is_active: row.is_active,
    });
    flash(`班次【${row.shift_name}】已保存`);
    emit('changed');
  } catch (e) {
    flash(e.message || '保存失败', 'err');
  }
}

function remove(row) {
  confirmState.value = {
    visible: true,
    shift: row,
    message: `确定删除班次【${row.shift_name}】？删除后需重新统计才能按新班次口径查看。`,
  };
}

async function handleConfirm() {
  const shift = confirmState.value.shift;
  confirmState.value.visible = false;
  if (!shift) return;
  try {
    await apiPost('/api/stats/shifts/delete', { id: shift.id });
    flash(`班次【${shift.shift_name}】已删除`);
    emit('changed');
  } catch (e) {
    flash(e.message || '删除失败', 'err');
  }
}

async function initDefault() {
  try {
    const res = await apiPost('/api/stats/shifts/init', {});
    flash(res.created ? `已生成 ${res.created} 个标准班次` : '标准班次已存在，无需重复生成');
    emit('changed');
  } catch (e) {
    flash(e.message || '生成失败', 'err');
  }
}

function close() {
  emit('close');
}
</script>

<style scoped>
.shift-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9998;
  padding: 20px;
}
.shift-dialog {
  width: 820px;
  max-width: 96vw;
  max-height: 88vh;
  display: flex;
  flex-direction: column;
  background: #16202e;
  border: 1px solid #2a3a52;
  border-radius: 12px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.55);
}
.shift-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid #24344a;
}
.shift-header h3 {
  margin: 0;
  font-size: 16px;
  color: #e6edf5;
}
.shift-close {
  background: none;
  border: none;
  color: #8ba3c7;
  font-size: 24px;
  line-height: 1;
  cursor: pointer;
}
.shift-close:hover { color: #e6edf5; }
.shift-body {
  padding: 16px 20px 20px;
  overflow-y: auto;
}
.shift-message {
  margin-bottom: 12px;
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 13px;
}
.shift-message.ok { background: rgba(82, 196, 26, 0.12); color: #7bd94c; }
.shift-message.err { background: rgba(255, 77, 79, 0.12); color: #ff787e; }
.shift-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}
.shift-mode { font-size: 12px; color: #8ba3c7; }
.shift-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.shift-table th {
  text-align: left;
  padding: 8px 8px;
  color: #8ba3c7;
  font-weight: 600;
  border-bottom: 1px solid #24344a;
}
.shift-table td {
  padding: 6px 8px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  color: #c8d6e8;
}
.shift-table input,
.shift-table select,
.shift-add input {
  background: #0d1420;
  border: 1px solid #2a3a52;
  border-radius: 6px;
  padding: 5px 8px;
  color: #e6edf5;
  font-size: 13px;
  outline: none;
  width: 100%;
  box-sizing: border-box;
  color-scheme: dark;
}
.shift-table input:focus,
.shift-add input:focus { border-color: #3b82f6; }
.shift-empty { text-align: center; color: #7d8ea6; padding: 20px 0; }
.shift-add {
  display: flex;
  align-items: flex-end;
  gap: 12px;
  margin-top: 14px;
  flex-wrap: wrap;
}
.shift-add label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: #8ba3c7;
}
.shift-add input { width: 130px; }
.shift-btn {
  padding: 6px 14px;
  border: 1px solid #2a3a52;
  border-radius: 6px;
  background: #1d2b3e;
  color: #c8d6e8;
  font-size: 13px;
  cursor: pointer;
}
.shift-btn:hover { border-color: #3b82f6; }
.shift-btn.primary { background: #3b82f6; border-color: #3b82f6; color: #fff; }
.shift-btn.primary:hover { background: #2f6fe0; }
.shift-btn.danger { background: rgba(255, 77, 79, 0.12); border-color: rgba(255, 77, 79, 0.5); color: #ff787e; }
.shift-btn.small { padding: 3px 8px; font-size: 12px; margin-right: 6px; }
.shift-btn:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
