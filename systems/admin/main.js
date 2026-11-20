import { createApp } from 'vue';
import AdminApp from './AdminApp.vue';
import { initAdminTokenFromUrl } from '../shared/api';
import '../../css/style.css';

// 支持通过 /admin?token=xxx 一次性写入管理令牌（启用 ADMIN_TOKEN 时使用）
initAdminTokenFromUrl();

createApp(AdminApp).mount('#app');
