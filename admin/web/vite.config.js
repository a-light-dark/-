import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// base 用 './' 是为了直接丢进「云开发静态网站托管」的任意目录都能跑
export default defineConfig({
  base: './',
  plugins: [vue()],
  build: {
    outDir: 'dist',
    target: 'esnext',
    chunkSizeWarningLimit: 1200,
  },
  server: {
    port: 5173,
  },
})
