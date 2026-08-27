import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    // Allow the sandbox preview host.
    allowedHosts: true,
    // Dev-only: forward API + sandbox-checkout calls to the local backend so
    // the browser can use relative URLs (never hardcoded localhost).
    proxy: {
      '/api': 'http://localhost:8080',
      '/sandbox': 'http://localhost:8080',
    },
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
    allowedHosts: true,
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router-dom'],
        },
      },
    },
  },
});
