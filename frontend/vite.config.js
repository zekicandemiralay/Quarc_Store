import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// /api/auth/* goes to the shared Quarc Auth service; everything else under
// /api/* goes to the Store's own backend. Mirrors how nginx splits these two
// routes in production.
const apiProxy = {
  '/api/auth': {
    target: process.env.VITE_AUTH_PROXY_TARGET || 'http://localhost:3002',
    changeOrigin: true,
  },
  '/api': {
    target: process.env.VITE_API_PROXY_TARGET || 'http://localhost:3007',
    changeOrigin: true,
  },
};

export default defineConfig({
  plugins: [react()],
  server: { proxy: apiProxy },
  preview: { proxy: apiProxy },
});
