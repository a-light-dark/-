import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// base 用 './' 是为了直接丢进「云开发静态网站托管」的任意目录都能跑
export default defineConfig({
  base: './',
  plugins: [vue()],
  build: {
    // 演示模式（VITE_MOCK=true）单独输出到 dist-mock，避免把假数据构建传上线
    outDir: process.env.VITE_MOCK === 'true' ? 'dist-mock' : 'dist',
    target: 'esnext',
    chunkSizeWarningLimit: 1200,
  },
  server: {
    port: 5173,
  },
})
