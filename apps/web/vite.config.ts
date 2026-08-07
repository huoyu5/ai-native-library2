/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // 原样转发 /api/* → server（server 路由统一带 /api 前缀）
      '/api': 'http://localhost:3000'
    }
  },
  test: {
    environment: 'jsdom'
  }
})
