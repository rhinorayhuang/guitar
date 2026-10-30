import { fileURLToPath } from 'node:url'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  // 元件測試（tests/components，檔頭指定 happy-dom）需要編譯 SFC（ADR-006）
  plugins: [vue()],
  resolve: {
    alias: { '~': fileURLToPath(new URL('./app', import.meta.url)) },
  },
  test: { include: ['tests/**/*.spec.ts'] },
})
