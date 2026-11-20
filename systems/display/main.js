import { createApp } from 'vue';
import DisplayApp from './DisplayApp.vue';
import { initAdminTokenFromUrl } from '../shared/api';
import '../../css/style.css';

initAdminTokenFromUrl();

createApp(DisplayApp).mount('#app');
