import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  server: {
    // Force disable HMR to stop LocalTunnel WebSocket crashes on your phone
    hmr: false,

    // Tell Vite to accept connections from outside hosts (like your phone via tunnel)
    allowedHosts: true as const,

    // Route all frontend /api requests straight to your Python FastAPI backend
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      }
    }
  },
});