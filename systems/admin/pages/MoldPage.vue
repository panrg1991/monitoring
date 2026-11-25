<template>
  <section class="page mold-manage">
    <div class="dashboard-header">
      <h1 class="dashboard-title">模具档案</h1>
      <div class="header-actions">
        <button v-if="can('mold', 'create')" class="refresh-btn" @click="openCreate">+ 新增模具</button>
      </div>
    </div>

    <div class="stats-bar">
      <div class="stat-item">
        <div class="stat-icon total">&#129521;</div>
        <div class="stat-info">
          <div class="stat-num">{{ stats.total }}</div>
          <div class="stat-label">模具总数</div>
        </div>
      </div>
      <div class="stat-item">
        <div class="stat-icon running">&#9989;</div>
        <div class="stat-info">
          <div class="stat-num">{{ stats.used }}</div>
          <div class="stat-label">已被配方引用</div>
        </div>
      </div>
      <div class="stat-item">
        <div class="stat-icon offline">&#9208;</div>
        <div class="stat-info">
          <div class="stat-num">{{ stats.unused }}</div>
          <div class="stat-label">未引用</div>
        </div>
      </div>
      <div class="stat-item">
        <div class="stat-icon warning">&#9888;</div>
        <div class="stat-info">
          <div class="stat-num">{{ stats.inactive }}</div>
          <div class="stat-label">已停用</div>
        </div>
      </div>
    </div>

    <div class="tech-data-container">
      <div class="filter-bar">
        <div class="filter-group">
          <label>关键字</label>
          <input v-model="filter.keyword" placeholder="模具名称 / 编码 / 说明" @keyup.enter="loadMolds" />
        </div>
        <div class="filter-group">
          <label>模具类型</label>
          <select v-model="filter.type">
            <option value="">全部类型</option>
            <option v-for="t in types" :key="t" :value="t">{{ t }}</option>
          </select>
        </div>
        <div class="filter-group">
          <label>启用状态</label>
          <select v-model="filter.active">
            <option value="">全部</option>
            <option value="1">启用</option>
            <option value="0">停用</option>
          </select>
        </div>
        <button class="btn-search" @click="loadMolds">搜索</button>
        <button class="btn-reset" @click="resetFilter">重置</button>
      </div>

      <div v-if="loading" class="page-hint">数据加载中…</div>

      <div class="data-table-wrapper">
        <div class="data-toolbar">
          <span>共 <b>{{ total }}</b> 套模具</span>
          <span v-if="message" class="mold-message">{{ message }}</span>
        </div>

        <div class="table-scroll">
          <table class="data-table">
            <thead>
              <tr>
                <th class="idx-col">序号</th>
                <th>模具名称</th>
                <th>模具编码</th>
                <th>模具类型</th>
                <th>说明</th>
                <th>配方引用</th>
                <th>启用状态</th>
                <th>更新时间</th>
                <th style="width:150px;">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(m, idx) in molds" :key="m.id">
                <td class="idx-col">{{ idx + 1 }}</td>
                <td>{{ m.mold_name }}</td>
                <td class="code-cell">{{ m.mold_code || '--' }}</td>
                <td>{{ m.mold_type || '--' }}</td>
                <td class="desc-cell" :title="m.description || ''">{{ m.description || '--' }}</td>
                <td>
                  <span :class="{ 'usage-link': Number(m.recipe_count) > 0 }">{{ m.recipe_count }} 条</span>
                </td>
                <td>
                  <span class="active-tag" :class="Number(m.is_active) === 1 ? 'on' : 'off'">
                    {{ Number(m.is_active) === 1 ? '启用' : '停用' }}
                  </span>
                </td>
                <td>{{ m.updated_at || m.created_at || '--' }}</td>
                <td>
                  <button v-if="can('mold', 'update')" class="link-btn" @click="openEdit(m)">编辑</button>
                  <button v-if="can('mold', 'delete')" class="link-btn danger" @click="askDelete(m)">删除</button>
                </td>
              </tr>
              <tr v-if="!molds.length && !loading">
                <td colspan="9" style="text-align:center;color:var(--text-secondary);padding:30px 0;">暂无模具，点击「新增模具」创建</td>
              </tr>
            </tbody>
          </table>
        </div>

      </div>
    </div>

    <MoldEditDialog
      :visible="dialogVisible"
      :mold="editingMold"
      :types="types"
      @close="dialogVisible = false"
      @saved="onSaved"
    />

    <AppDialog
      :visible="confirmState.visible"
      title="删除模具"
      :message="confirmState.message"
      mode="confirm"
      @confirm="handleConfirm"
      @cancel="confirmState.visible = false"
    />
  </section>
</template>

<script setup>
import { ref, watch, onMounted } from 'vue';
import { apiGet, apiPost } from '../../shared/api';
import { can } from '../../shared/auth';
import MoldEditDialog from './MoldEditDialog.vue';
import AppDialog from '../../shared/AppDialog.vue';

const props = defineProps({
  active: { type: Boolean, default: false },
});

const molds = ref([]);
const types = ref([]);
const total = ref(0);
const stats = ref({ total: 0, used: 0, unused: 0, inactive: 0 });
const filter = ref({ keyword: '', type: '', active: '' });
const loading = ref(false);
const message = ref('');
const dialogVisible = ref(false);
const editingMold = ref(null);
const confirmState = ref({ visible: false, message: '', mold: null });

function flash(text) {
  message.value = text;
  setTimeout(() => {
    if (message.value === text) message.value = '';
  }, 4000);
}

async function loadMolds() {
  loading.value = true;
  try {
    const params = new URLSearchParams();
    if (filter.value.keyword) params.set('keyword', filter.value.keyword);
    if (filter.value.type) params.set('type', filter.value.type);
    if (filter.value.active !== '') params.set('active', filter.value.active);
    const data = await apiGet(`/api/molds/list?${params.toString()}`);
    molds.value = data.molds || [];
    types.value = data.types || [];
    total.value = data.total || 0;
    stats.value = data.stats || stats.value;
  } catch (e) {
    console.error('加载模具列表失败', e);
    molds.value = [];
    total.value = 0;
    flash(`加载失败：${e.message}`);
  } finally {
    loading.value = false;
  }
}

function resetFilter() {
  filter.value = { keyword: '', type: '', active: '' };
  loadMolds();
}

function openCreate() {
  editingMold.value = null;
  dialogVisible.value = true;
}

function openEdit(mold) {
  editingMold.value = mold;
  dialogVisible.value = true;
}

function onSaved() {
  flash('模具信息已保存');
  loadMolds();
}

function askDelete(mold) {
  const used = Number(mold.recipe_count) || 0;
  confirmState.value = {
    visible: true,
    mold,
    message: used > 0
      ? `模具【${mold.mold_name}】已被 ${used} 条配方引用，删除会破坏关联，请先调整配方。`
      : `确定删除模具【${mold.mold_name}】？删除后不可恢复。`,
  };
}

async function handleConfirm() {
  const mold = confirmState.value.mold;
  confirmState.value.visible = false;
  if (!mold) return;
  try {
    await apiPost('/api/molds/delete', { id: mold.id });
    flash(`模具【${mold.mold_name}】已删除`);
    loadMolds();
  } catch (e) {
    flash(e.message || '删除失败');
  }
}

watch(
  () => props.active,
  (val) => {
    if (val) loadMolds();
  }
);

onMounted(() => {
  if (props.active) loadMolds();
});
</script>

<style scoped>
.header-actions {
  display: flex;
  gap: 12px;
}

.mold-message {
  color: #40a9ff;
  font-size: 12px;
}

.code-cell {
  font-family: 'Courier New', monospace;
  color: #40a9ff;
}

.desc-cell {
  max-width: 260px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.usage-link {
  color: #faad14;
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
