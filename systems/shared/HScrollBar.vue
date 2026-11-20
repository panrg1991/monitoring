<template>
  <div v-show="visible" class="h-scrollbar" @click="jumpTo">
    <div
      class="h-scrollbar-thumb"
      :class="{ dragging }"
      :style="{ width: widthPercent + '%', left: leftPercent + '%' }"
      @mousedown.stop.prevent="startDrag"
    ></div>
  </div>
</template>

<script setup>
/**
 * 表格横向进度条
 * 用法：给滚动容器加 ref 并传入 <HScrollBar :target="scrollRef" />，
 * 容器建议加 class="table-scroll no-native-scrollbar" 隐藏原生滚动条。
 * 列宽/窗口尺寸变化通过 ResizeObserver 自动重新测量。
 */
import { ref, computed, watch, onBeforeUnmount } from 'vue';

const props = defineProps({
  // 模板 ref（ref 对象）或 DOM 元素
  target: { type: Object, default: null },
});

const visible = ref(false);
const widthPercent = ref(100);
const leftPercent = ref(0);
const dragging = ref(false);

let dragState = null;
let observer = null;
let boundEl = null;

const scrollEl = computed(() => {
  const target = props.target;
  return target && target.value !== undefined ? target.value : target;
});

function measure() {
  const el = scrollEl.value;
  if (!el || !el.clientWidth) {
    visible.value = false;
    return;
  }
  if (el.scrollWidth - el.clientWidth <= 1) {
    visible.value = false;
    return;
  }
  visible.value = true;
  widthPercent.value = Math.max((el.clientWidth / el.scrollWidth) * 100, 6);
  leftPercent.value = (el.scrollLeft / el.scrollWidth) * 100;
}

function unbind() {
  if (boundEl) boundEl.removeEventListener('scroll', measure);
  if (observer) observer.disconnect();
  observer = null;
  boundEl = null;
}

function bind(el) {
  unbind();
  if (!el || !el.addEventListener) return;
  boundEl = el;
  el.addEventListener('scroll', measure, { passive: true });
  if (typeof ResizeObserver !== 'undefined') {
    observer = new ResizeObserver(measure);
    observer.observe(el);
    if (el.firstElementChild) observer.observe(el.firstElementChild);
  }
  measure();
}

watch(scrollEl, (el) => bind(el), { immediate: true });

function onDragMove(event) {
  const el = scrollEl.value;
  if (!el || !dragState) return;
  const trackWidth = el.clientWidth;
  const thumbPx = Math.max((el.clientWidth * el.clientWidth) / el.scrollWidth, 1);
  const movable = Math.max(trackWidth - thumbPx, 1);
  const ratio = (el.scrollWidth - el.clientWidth) / movable;
  el.scrollLeft = dragState.startScrollLeft + (event.clientX - dragState.startX) * ratio;
}

function stopDrag() {
  dragState = null;
  dragging.value = false;
  window.removeEventListener('mousemove', onDragMove);
  window.removeEventListener('mouseup', stopDrag);
}

function startDrag(event) {
  const el = scrollEl.value;
  if (!el) return;
  dragState = { startX: event.clientX, startScrollLeft: el.scrollLeft };
  dragging.value = true;
  window.addEventListener('mousemove', onDragMove);
  window.addEventListener('mouseup', stopDrag);
}

// 点击轨道空白处按比例跳转
function jumpTo(event) {
  const el = scrollEl.value;
  if (!el) return;
  const rect = event.currentTarget.getBoundingClientRect();
  const percent = Math.min(Math.max((event.clientX - rect.left) / rect.width, 0), 1);
  el.scrollLeft = percent * (el.scrollWidth - el.clientWidth);
}

onBeforeUnmount(() => {
  unbind();
  stopDrag();
});
</script>
