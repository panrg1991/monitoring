<template>
  <section class="page pipeline">
    <div class="dashboard-header">
      <h1 class="dashboard-title">管路参数控制</h1>
    </div>

    <div class="pipeline-module">
      <div class="pipeline-left">
        <h2>当前管路参数</h2>
        <div class="table-scroll">
        <table class="pipeline-current-table">
          <thead>
            <tr>
              <th>参数名称</th>
              <th>当前值</th>
              <th>更新时间</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="p in pipelineData" :key="p.id">
              <td>{{ p.param_name }}</td>
              <td>{{ p.param_value }} {{ p.param_unit || '' }}</td>
              <td>{{ p.updated_at }}</td>
            </tr>
            <tr v-if="!pipelineData.length">
              <td colspan="3" style="text-align:center;color:var(--text-secondary);">暂无管路参数数据</td>
            </tr>
          </tbody>
        </table>
        </div>
      </div>

      <div class="pipeline-right" v-if="isAdmin && can('pipeline', 'update')">
        <h2>参数下发</h2>
        <div class="pipeline-edit-form">
          <div class="form-group">
            <label>压力设定（MPa）</label>
            <input v-model.number="pipelineForm.pressure" type="number" step="0.1" placeholder="请输入压力设定值" />
          </div>
          <div class="form-group">
            <label>温度设定（&#8451;）</label>
            <input v-model.number="pipelineForm.temperature" type="number" step="0.1" placeholder="请输入温度设定值" />
          </div>
          <div class="form-group">
            <label>流量设定（L/min）</label>
            <input v-model.number="pipelineForm.flow" type="number" step="0.1" placeholder="请输入流量设定值" />
          </div>
          <div class="form-group">
            <label>阀门开度（%）</label>
            <input v-model.number="pipelineForm.valve" type="number" step="1" placeholder="请输入阀门开度" />
          </div>
          <button class="btn-submit" @click="updatePipelineData">一键下发</button>
        </div>
      </div>
    </div>

    <!-- 提示弹窗（替代原生 alert） -->
    <AppDialog
      v-model:visible="dialogVisible"
      :title="dialogTitle"
      :message="dialogMessage"
      mode="alert"
    />
  </section>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue';
import { apiGet, apiPost } from '../api';
import { can } from '../auth';
import AppDialog from '../AppDialog.vue';

const props = defineProps({
  active: { type: Boolean, default: false },
  // display = 前端显示系统（只读看板）；admin = 后端管理系统（含参数下发）
  viewMode: { type: String, default: 'admin' },
});

const isAdmin = computed(() => props.viewMode !== 'display');

const dialogVisible = ref(false);
const dialogTitle = ref('提示');
const dialogMessage = ref('');

function showAlert(message, title = '提示') {
  dialogTitle.value = title;
  dialogMessage.value = message;
  dialogVisible.value = true;
}

const pipelineData = ref([]);
const pipelineForm = ref({ pressure: '', temperature: '', flow: '', valve: '' });

async function loadPipelineData() {
  try {
    const data = await apiGet('/api/pipeline');
    pipelineData.value = data || [];
  } catch (e) {
    console.error('加载管路数据失败', e);
  }
}

async function updatePipelineData() {
  const { pressure, temperature, flow, valve } = pipelineForm.value;
  if (pressure === '' || temperature === '' || flow === '' || valve === '') {
    showAlert('请填写完整的管路参数');
    return;
  }
  try {
    await apiPost('/api/pipeline/update', {
      pressure: Number(pressure),
      temperature: Number(temperature),
      flow: Number(flow),
      valve: Number(valve),
    });
    showAlert('参数下发成功');
    pipelineForm.value = { pressure: '', temperature: '', flow: '', valve: '' };
    loadPipelineData();
  } catch (e) {
    showAlert('参数下发失败：' + e.message, '错误');
  }
}

watch(
  () => props.active,
  (val) => {
    if (val) loadPipelineData();
  }
);

onMounted(() => {
  if (props.active) loadPipelineData();
});
</script>
