import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const server = 'http://localhost:4400';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react()],
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    // The editor bundle and the icon catalog are each several megabytes by nature.
    chunkSizeWarningLimit: 8000
  },
  server: {
    port: 4401,
    proxy: { '/api': server, '/mcp': server }
  }
});
