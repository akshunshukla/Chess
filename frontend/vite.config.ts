import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

export default defineConfig(({ mode }) => {
  const projectRoot = fileURLToPath(new URL('.', import.meta.url))
  const { DEV_BACKEND_URL } = loadEnv(mode, projectRoot, '')

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },
    server: {
      port: 5173,
      strictPort: true,
      // This proxy runs only in development. Production needs a reverse proxy.
      proxy: DEV_BACKEND_URL
        ? {
            '/api': { target: DEV_BACKEND_URL, changeOrigin: true },
            '/ws': { target: DEV_BACKEND_URL, changeOrigin: true, ws: true },
          }
        : undefined,
    },
  }
})
