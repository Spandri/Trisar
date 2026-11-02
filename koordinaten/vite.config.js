import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5175,
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
      '/ollama': {
        target: 'http://host.docker.internal:11434',
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
        target: 'http://host.docker.internal:8787',
        changeOrigin: true,
        secure: false,
        ws: false,
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
