<template>
  <div class="recipe-overlay" v-if="visible" @click.self="close">
    <div class="recipe-dialog">
      <div class="recipe-dialog-header">
        <h3>{{ isEdit ? '编辑配方' : '新增配方' }}</h3>
        <button class="recipe-close" @click="close">&times;</button>
      </div>

      <div class="recipe-dialog-body">
        <div class="recipe-message" v-if="error">{{ error }}</div>

        <div class="recipe-section">
          <div class="recipe-section-title">关联信息</div>
          <div class="recipe-form">
            <label>产品 <i>*</i>
              <select v-model="form.product_id">
                <option value="">请选择产品</option>
                <option v-for="p in options.products" :key="p.id" :value="String(p.id)">
                  {{ p.product_name }}{{ p.product_code ? `（${p.product_code}）` : '' }}
                </option>
              </select>
            </label>
            <label>模具
              <select v-model="form.mold_id">
                <option value="">未指定模具</option>
                <option v-for="m in options.molds" :key="m.id" :value="String(m.id)">
                  {{ m.mold_name }}{{ m.mold_code ? `（${m.mold_code}）` : '' }}
                </option>
              </select>
            </label>
            <label>生产线
              <input v-model="form.production_line" list="recipe-line-options" placeholder="如：1号线" />
              <datalist id="recipe-line-options">
                <option v-for="l in options.lines" :key="l" :value="l"></option>
              </datalist>
            </label>
          </div>
        </div>

        <div class="recipe-section">
          <div class="recipe-section-title">快压射参数</div>
          <div class="recipe-form">
            <label>一快
              <select v-model="form.fast1_enabled">
                <option value="是">开启</option>
                <option value="否">关闭</option>
              </select>
            </label>
            <label>一快位置 (mm)
              <input v-model.number="form.fast1_position" type="number" step="0.1" />
            </label>
            <label>一快阀位
              <input v-model.number="form.fast1_valve" type="number" step="0.1" />
            </label>
            <label>二快
              <select v-model="form.fast2_enabled">
                <option value="是">开启</option>
                <option value="否">关闭</option>
              </select>
            </label>
            <label>二快位置 (mm)
              <input v-model.number="form.fast2_position" type="number" step="0.1" />
            </label>
            <label>二快阀位
              <input v-model.number="form.fast2_valve" type="number" step="0.1" />
            </label>
          </div>
        </div>

        <div class="recipe-section">
          <div class="recipe-section-title">增压与工艺时间</div>
          <div class="recipe-form">
            <label>增压
              <select v-model="form.boost_enabled">
                <option value="1">开启</option>
                <option value="0">关闭</option>
              </select>
            </label>
            <label>增压位置 (mm)
              <input v-model.number="form.boost_position" type="number" step="0.1" />
            </label>
            <label>增压压力 (MPa)
              <input v-model.number="form.boost_pressure" type="number" step="0.1" />
            </label>
            <label>跟踪终点 (mm)
              <input v-model.number="form.track_end_pos" type="number" step="0.1" />
            </label>
            <label>快射储能
              <input v-model.number="form.fast_energy_pressure" type="number" step="0.1" />
            </label>
            <label>增压储能
              <input v-model.number="form.boost_energy_pressure" type="number" step="0.1" />
            </label>
            <label>压射时间 (s)
              <input v-model.number="form.injection_time" type="number" step="0.1" />
            </label>
            <label>增压延时 (s)
              <input v-model.number="form.boost_delay" type="number" step="0.1" />
            </label>
            <label>冷却时间 (s)
              <input v-model.number="form.cooling_time" type="number" step="0.1" />
            </label>
            <label>锤击延时 (s)
              <input v-model.number="form.hammer_delay" type="number" step="0.1" />
            </label>
            <label>慢压流量
              <input v-model.number="form.slow_flow" type="number" step="0.1" />
            </label>
            <label>备注
              <input v-model="form.remark" placeholder="选填" />
            </label>
          </div>
        </div>

      </div>

      <div class="recipe-dialog-actions">
        <button class="recipe-btn" @click="close">取消</button>
        <button class="recipe-btn primary" :disabled="saving" @click="submit">{{ saving ? '保存中...' : '保存' }}</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue';
import { apiPost } from '../api';

const props = defineProps({
  visible: { type: Boolean, default: false },
  recipe: { type: Object, default: null },
  options: { type: Object, default: () => ({ products: [], molds: [], lines: [] }) },
});

const emit = defineEmits(['close', 'saved']);

const NUMERIC_FIELDS = [
  'fast1_position', 'fast1_valve', 'fast2_position', 'fast2_valve',
  'boost_position', 'boost_pressure', 'track_end_pos',
  'fast_energy_pressure', 'boost_energy_pressure',
  'injection_time', 'boost_delay', 'cooling_time', 'hammer_delay', 'slow_flow',
];

const emptyForm = () => ({
  product_id: '',
  mold_id: '',
  production_line: '',
  fast1_enabled: '是',
  fast2_enabled: '否',
  boost_enabled: '1',
  fast1_position: 0,
  fast1_valve: 0,
  fast2_position: 0,
  fast2_valve: 0,
  boost_position: 0,
  boost_pressure: 0,
  track_end_pos: 0,
  fast_energy_pressure: 0,
  boost_energy_pressure: 0,
  injection_time: 0,
  boost_delay: 0,
  cooling_time: 0,
  hammer_delay: 0,
  slow_flow: 0,
  remark: '',
});

const form = ref(emptyForm());
const error = ref('');
const saving = ref(false);

const isEdit = computed(() => !!(props.recipe && props.recipe.id));

function fillForm() {
  const source = props.recipe;
  if (source) {
    const next = emptyForm();
    next.product_id = source.product_id ? String(source.product_id) : '';
    next.mold_id = source.mold_id ? String(source.mold_id) : '';
    next.production_line = source.production_line || '';
    next.fast1_enabled = source.fast1_enabled === '是' ? '是' : '否';
    next.fast2_enabled = source.fast2_enabled === '是' ? '是' : '否';
    next.boost_enabled = String(source.boost_enabled) === '1' ? '1' : '0';
    NUMERIC_FIELDS.forEach((field) => {
      const num = Number(source[field]);
      next[field] = Number.isFinite(num) ? num : 0;
    });
    next.remark = source.remark || '';
    form.value = next;
  } else {
    form.value = emptyForm();
  }
  error.value = '';
}

watch(
  () => props.visible,
  (val) => {
    if (val) fillForm();
  }
);

async function submit() {
  error.value = '';
  if (!form.value.product_id) { error.value = '请选择产品（产品档案维护在「产品管理」）'; return; }

  saving.value = true;
  try {
    const payload = { ...form.value, mold_id: form.value.mold_id || null };
    if (isEdit.value) {
      await apiPost('/api/recipes/update', { id: props.recipe.id, ...payload });
    } else {
      await apiPost('/api/recipes/create', payload);
    }
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
.recipe-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9998;
  padding: 20px;
}
.recipe-dialog {
  width: 860px;
  max-width: 96vw;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  background: #16202e;
  border: 1px solid #2a3a52;
  border-radius: 12px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.55);
}
.recipe-dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid #24344a;
}
.recipe-dialog-header h3 {
  margin: 0;
  font-size: 16px;
  color: #e6edf5;
}
.recipe-close {
  background: none;
  border: none;
  color: #8ba3c7;
  font-size: 24px;
  line-height: 1;
  cursor: pointer;
}
.recipe-close:hover { color: #e6edf5; }
.recipe-dialog-body {
  padding: 16px 20px;
  overflow-y: auto;
}
.recipe-message {
  margin-bottom: 12px;
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 13px;
  background: rgba(255, 77, 79, 0.12);
  color: #ff787e;
}
.recipe-section {
  margin-bottom: 16px;
}
.recipe-section-title {
  margin-bottom: 10px;
  font-size: 13px;
  color: #40a9ff;
  border-left: 3px solid #3b82f6;
  padding-left: 8px;
}
.recipe-form {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 12px 16px;
}
.recipe-form label {
  display: flex;
  flex-direction: column;
  gap: 5px;
  font-size: 12px;
  color: #8ba3c7;
}
.recipe-form label i {
  color: #ff787e;
  font-style: normal;
}
.recipe-form label.wide { grid-column: span 3; }
.recipe-form input,
.recipe-form select {
  background: #0d1420;
  border: 1px solid #2a3a52;
  border-radius: 6px;
  padding: 7px 10px;
  color: #e6edf5;
  font-size: 13px;
  outline: none;
  width: 100%;
  box-sizing: border-box;
}
.recipe-form input:focus,
.recipe-form select:focus { border-color: #3b82f6; }
.recipe-dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 14px 20px;
  border-top: 1px solid #24344a;
}
.recipe-btn {
  padding: 7px 18px;
  border: 1px solid #2a3a52;
  border-radius: 6px;
  background: #1d2b3e;
  color: #c8d6e8;
  font-size: 13px;
  cursor: pointer;
}
.recipe-btn:hover { border-color: #3b82f6; }
.recipe-btn.primary { background: #3b82f6; border-color: #3b82f6; color: #fff; }
.recipe-btn.primary:hover { background: #2f6fe0; }
.recipe-btn:disabled { opacity: 0.6; cursor: not-allowed; }
@media (max-width: 760px) {
  .recipe-form { grid-template-columns: 1fr; }
  .recipe-form label.wide { grid-column: span 1; }
}
</style>
