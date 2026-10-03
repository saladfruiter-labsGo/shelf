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
      // Sem changeOrigin: a API confere se Origin e Host batem (proteção
      // contra CSRF), e o login da Steam precisa voltar para a origem do navegador.
      '/api': {
        target: 'http://localhost:3000',
      },
      '/auth': {
        target: 'http://localhost:3000',
      },
    },
  },
})
