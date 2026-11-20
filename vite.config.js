import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { resolve } from 'node:path';

// 两套前端系统共用一个构建：
//   index.html  → 前端显示系统（车间看板，systems/display）
//   admin.html  → 后端管理系统（管理后台，systems/admin）
export default defineConfig({
  plugins: [
    vue(),
    {
      // 开发模式下允许直接访问 /admin（等价于 /admin.html）
      name: 'admin-entry-rewrite',
      configureServer(server) {
        server.middlewares.use((req, _res, next) => {
          if (req.url === '/admin' || req.url === '/admin/') req.url = '/admin.html';
          next();
        });
      },
    },
  ],
  server: {
    port: 5173,
    // 开发模式下将 /api 请求代理到后端服务
    proxy: {
      '/api': {
        target: 'http://localhost:3456',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    rollupOptions: {
      input: {
        display: resolve(__dirname, 'index.html'),
        admin: resolve(__dirname, 'admin.html'),
      },
    },
  },
});
