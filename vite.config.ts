import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: '/',
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: false,
    // Ίδιο origin με production (Firebase Hosting rewrite) — αποφεύγει CORS στο dev
    proxy: {
      '/api/submitInterestLead': {
        target: 'https://europe-west1-performance-plus-4a5b2.cloudfunctions.net',
        changeOrigin: true,
        secure: true,
        rewrite: () => '/submitInterestLead',
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
})
