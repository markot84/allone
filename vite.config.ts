import { defineConfig } from 'vitest/config'
import { loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const projectId = env.VITE_FIREBASE_PROJECT_ID
  if (!projectId) {
    throw new Error('[vite] Missing VITE_FIREBASE_PROJECT_ID — set it in .env (see .env.example)')
  }
  const region = env.VITE_FIREBASE_FUNCTIONS_REGION || 'europe-west1'

  return {
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
        target: `https://${region}-${projectId}.cloudfunctions.net`,
        changeOrigin: true,
        secure: true,
        rewrite: () => '/submitInterestLead',
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 650,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return

          if (id.includes('recharts') || id.includes('victory-vendor')) return 'charts'
          if (id.includes('xlsx')) return 'xlsx'
          if (id.includes('firebase')) return 'firebase'
          if (id.includes('jspdf') || id.includes('jspdf-autotable')) return 'pdf-tools'
          if (id.includes('html2canvas')) return 'canvas-tools'
          if (id.includes('@primer')) return 'primer'
          if (id.includes('framer-motion')) return 'motion'
          if (id.includes('lucide-react')) return 'icons'
        },
      },
    },
  },
  }
})
