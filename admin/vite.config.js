import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In Docker erreichen die Proxies den Host über host.docker.internal;
// bei einem Dev-Lauf direkt auf dem Mac: VITE_PROXY_HOST=127.0.0.1 setzen.
const PROXY_HOST = process.env.VITE_PROXY_HOST || 'host.docker.internal';

export default defineConfig({
  plugins: [react()],
  // MapLibre startet seinen Arbeiter als ES-Modul; sonst fehlt ihm nach dem
  // Buendeln die Datei mit dem gemeinsamen Code und die Karte bleibt schwarz.
  worker: { format: 'es', rollupOptions: { output: { entryFileNames: 'assets/[name]-[hash].b.js' } } },
  // Endung .b im Namen: eine abgebrochene Veroeffentlichung hatte unter den alten
  // Namen die Startseite ausgeliefert, und Browser halten das vier Stunden fest.
  build: {
    rollupOptions: {
      output: {
        entryFileNames: 'assets/[name]-[hash].b.js',
        chunkFileNames: 'assets/[name]-[hash].b.js',
        assetFileNames: 'assets/[name]-[hash].b[extname]',
      },
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5177,
    strictPort: true,
    fs: {
      allow: ['..'],
    },
    allowedHosts: ['.trycloudflare.com', '.trisar.de'],
    proxy: {
      '/supabase': {
        target: `http://${PROXY_HOST}:54321`,
        changeOrigin: true,
        secure: false,
        ws: true,
        rewrite: (path) => path.replace(/^\/supabase/, ''),
      },
      '/ollama': {
        target: `http://${PROXY_HOST}:11434`,
        changeOrigin: true,
        secure: false,
        ws: false,
        rewrite: (path) => path.replace(/^\/ollama/, ''),
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => {
            // Ollama rejects non-local origins with 403; drop browser-origin headers.
            proxyReq.removeHeader('origin');
            proxyReq.removeHeader('referer');
          });
        },
      },
      '/webhook': {
        target: `http://${PROXY_HOST}:8787`,
        changeOrigin: true,
        secure: false,
        ws: false,
      },
      '/planner': {
        target: `http://${PROXY_HOST}:8790`,
        changeOrigin: true,
        secure: false,
        ws: false,
        rewrite: (path) => path.replace(/^\/planner/, ''),
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
});
