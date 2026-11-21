import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// En développement, /api est relayé vers le backend FastAPI
export default defineConfig({
  plugins: [react()],
  build: { rollupOptions: { output: { manualChunks: { maplibre: ['maplibre-gl'] } } }, chunkSizeWarningLimit: 900 },
  server: {
    port: 5173,
    proxy: { '/api': { target: process.env.VITE_API_TARGET ?? 'http://localhost:8000', changeOrigin: true } },
  },
})
