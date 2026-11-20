<template>
  <section class="page product-manage">
    <div class="dashboard-header">
      <h1 class="dashboard-title">产品管理</h1>
      <div class="header-actions">
        <button class="refresh-btn" @click="openCreate">+ 新增产品</button>
      </div>
    </div>

    <div class="stats-bar">
      <div class="stat-item">
        <div class="stat-icon total">&#128230;</div>
        <div class="stat-info">
          <div class="stat-num">{{ stats.total }}</div>
          <div class="stat-label">产品总数</div>
        </div>
      </div>
      <div class="stat-item">
        <div class="stat-icon running">&#9989;</div>
        <div class="stat-info">
          <div class="stat-num">{{ stats.used }}</div>
          <div class="stat-label">已被引用</div>
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
        <div class="stat-icon warning">&#127991;</div>
        <div class="stat-info">
          <div class="stat-num">{{ stats.typeCount }}</div>
          <div class="stat-label">产品类型</div>
        </div>
      </div>
    </div>

    <div class="tech-data-container">
      <div class="filter-bar">
        <div class="filter-group">
          <label>关键字</label>
          <input v-model="filter.keyword" placeholder="产品名称 / 编码 / 说明" @keyup.enter="loadProducts" />
        </div>
        <div class="filter-group">
          <label>产品类型</label>
          <select v-model="filter.type">
            <option value="">全部类型</option>
            <option v-for="t in types" :key="t" :value="t">{{ t }}</option>
          </select>
        </div>
        <button class="btn-search" @click="loadProducts">搜索</button>
        <button class="btn-reset" @click="resetFilter">重置</button>
      </div>

      <div v-if="loading" class="page-hint">数据加载中…</div>

      <div class="data-table-wrapper">
        <div class="data-toolbar">
          <span>共 <b>{{ total }}</b> 个产品</span>
          <span v-if="message" class="product-message">{{ message }}</span>
        </div>

        <div class="table-scroll">
          <table class="data-table">
            <thead>
              <tr>
                <th class="idx-col">序号</th>
                <th>产品名称</th>
                <th>产品编码</th>
                <th>产品类型</th>
                <th>说明</th>
                <th>热成像记录</th>
                <th>更新时间</th>
                <th style="width:150px;">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(p, idx) in products" :key="p.id">
                <td class="idx-col">{{ idx + 1 }}</td>
                <td>{{ p.product_name }}</td>
                <td class="code-cell">{{ p.product_code || '--' }}</td>
                <td>{{ p.product_type || '--' }}</td>
                <td class="desc-cell" :title="p.description || ''">{{ p.description || '--' }}</td>
                <td>
                  <span :class="{ 'usage-link': Number(p.thermal_count) > 0 }">{{ p.thermal_count }} 条</span>
                </td>
                <td>{{ p.updated_at || p.created_at || '--' }}</td>
                <td>
                  <button class="link-btn" @click="openEdit(p)">编辑</button>
                  <button class="link-btn danger" @click="askDelete(p)">删除</button>
                </td>
              </tr>
              <tr v-if="!products.length && !loading">
                <td colspan="8" style="text-align:center;color:var(--text-secondary);padding:30px 0;">暂无产品，点击「新增产品」创建</td>
              </tr>
            </tbody>
          </table>
        </div>

      </div>
    </div>

    <ProductEditDialog
      :visible="dialogVisible"
      :product="editingProduct"
      :types="types"
      @close="dialogVisible = false"
      @saved="onSaved"
    />

    <AppDialog
      :visible="confirmState.visible"
      title="删除产品"
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
import ProductEditDialog from './ProductEditDialog.vue';
import AppDialog from '../../shared/AppDialog.vue';

const props = defineProps({
  active: { type: Boolean, default: false },
});

const products = ref([]);
const types = ref([]);
const total = ref(0);
const stats = ref({ total: 0, used: 0, unused: 0, typeCount: 0 });
const filter = ref({ keyword: '', type: '' });
const loading = ref(false);
const message = ref('');
const dialogVisible = ref(false);
const editingProduct = ref(null);
const confirmState = ref({ visible: false, message: '', product: null });

function flash(text) {
  message.value = text;
  setTimeout(() => {
    if (message.value === text) message.value = '';
  }, 4000);
}

async function loadProducts() {
  loading.value = true;
  try {
    const params = new URLSearchParams();
    if (filter.value.keyword) params.set('keyword', filter.value.keyword);
    if (filter.value.type) params.set('type', filter.value.type);
    const data = await apiGet(`/api/products/list?${params.toString()}`);
    products.value = data.products || [];
    types.value = data.types || [];
    total.value = data.total || 0;
    stats.value = data.stats || stats.value;
  } catch (e) {
    console.error('加载产品列表失败', e);
    products.value = [];
    total.value = 0;
    flash(`加载失败：${e.message}`);
  } finally {
    loading.value = false;
  }
}

function resetFilter() {
  filter.value = { keyword: '', type: '' };
  loadProducts();
}

function openCreate() {
  editingProduct.value = null;
  dialogVisible.value = true;
}

function openEdit(product) {
  editingProduct.value = product;
  dialogVisible.value = true;
}

function onSaved() {
  flash('产品信息已保存');
  loadProducts();
}

function askDelete(product) {
  const used = Number(product.thermal_count) || 0;
  confirmState.value = {
    visible: true,
    product,
    message: used > 0
      ? `产品【${product.product_name}】已被 ${used} 条热成像记录引用，删除会破坏关联，请先处理关联记录。`
      : `确定删除产品【${product.product_name}】？删除后不可恢复。`,
  };
}

async function handleConfirm() {
  const product = confirmState.value.product;
  confirmState.value.visible = false;
  if (!product) return;
  try {
    await apiPost('/api/products/delete', { id: product.id });
    flash(`产品【${product.product_name}】已删除`);
    loadProducts();
  } catch (e) {
    flash(e.message || '删除失败');
  }
}

watch(
  () => props.active,
  (val) => {
    if (val) loadProducts();
  }
);

onMounted(() => {
  if (props.active) loadProducts();
});
</script>

<style scoped>
.header-actions {
  display: flex;
  gap: 12px;
}

.product-message {
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
