import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // MapLibre startet seinen Arbeiter als ES-Modul; sonst fehlt ihm nach dem
  // Buendeln die Datei mit dem gemeinsamen Code und die Karte bleibt schwarz.
  worker: { format: 'es' },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    fs: {
      allow: ['..'],
    },
    allowedHosts: ['.trycloudflare.com', '.trisar.de'],
    proxy: {
      '/supabase': {
        target: 'http://host.docker.internal:54321',
        changeOrigin: true,
        secure: false,
        ws: true,
        rewrite: (path) => path.replace(/^\/supabase/, ''),
      },
    },
    watch: {
      usePolling: true,
      interval: 1000,
    },
  },
  optimizeDeps: {
    include: ['react', 'react-dom'],
  },
})
