import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  // The Vercel preview hostname is injected dynamically, so allow the
  // sandbox proxy to reach the Vite dev server during preview.
  server: {
    allowedHosts: true,
  },
})
