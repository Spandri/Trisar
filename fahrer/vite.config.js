import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // MapLibre startet seinen Arbeiter als ES-Modul; sonst fehlt ihm nach dem
  // Buendeln die Datei mit dem gemeinsamen Code und die Karte bleibt schwarz.
  worker: { format: 'es' },
  server: {
    // Hinter dem Cloudflare-Tunnel bekaemen die Quelldateien sonst 4 h Browser-Cache
    // (max-age=14400). Nach einem Update mischten sich dann alte und neue Module.
    headers: { 'Cache-Control': 'no-store' },
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
