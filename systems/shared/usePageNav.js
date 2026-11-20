import { ref, onMounted, onBeforeUnmount } from 'vue';

/**
 * 页面导航 + URL hash 持久化（刷新后停留在当前模块）
 * 显示端与管理端各自维护自己的模块列表，hash 不匹配时回退到各自默认页。
 *
 * @param {Array<{key: string, label: string}>} navItems 模块列表
 * @param {string} fallback 默认模块
 */
export function usePageNav(navItems, fallback = 'home') {
  const VALID_PAGES = navItems.map((item) => item.key);

  function pageFromHash() {
    const key = decodeURIComponent(String(window.location.hash || '').replace(/^#\/?/, '')).trim();
    return VALID_PAGES.includes(key) ? key : fallback;
  }

  const currentPage = ref(pageFromHash());
  const currentTime = ref('');
  let timer = null;

  function updateTime() {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    currentTime.value = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ` +
      `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  }

  function switchPage(page) {
    if (!VALID_PAGES.includes(page)) return;
    currentPage.value = page;
    if (window.location.hash !== `#${page}`) {
      window.history.replaceState(null, '', `#${page}`);
    }
  }

  function onHashChange() {
    currentPage.value = pageFromHash();
  }

  onMounted(() => {
    updateTime();
    timer = setInterval(updateTime, 1000);
    window.addEventListener('hashchange', onHashChange);
  });

  onBeforeUnmount(() => {
    if (timer) clearInterval(timer);
    window.removeEventListener('hashchange', onHashChange);
  });

  return { currentPage, currentTime, switchPage };
}
