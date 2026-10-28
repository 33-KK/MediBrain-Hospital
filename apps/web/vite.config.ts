import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'
import Components from 'unplugin-vue-components/vite'
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers'

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue(), Components({ resolvers: [ElementPlusResolver({ importStyle: 'css' })], dts: 'src/components.d.ts' })],
  build: {
    rollupOptions: { output: { manualChunks(id) {
      if (id.includes('/node_modules/zrender/')) return 'graph-renderer'
      if (id.includes('/node_modules/echarts/')) return 'graph-engine'
      if (id.includes('/node_modules/element-plus/')) {
        if (id.includes('/components/table/')) return 'ui-table'
        if (id.includes('/components/date-picker/') || id.includes('/components/time-picker/')) return 'ui-date'
        return 'ui-components'
      }
    } } },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
})
