import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist/public',
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      // Sem changeOrigin: o login da Steam precisa voltar para a origem do navegador.
      '/auth': {
        target: 'http://localhost:3000',
      },
    },
  },
})
