import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { apiPort, devWebPort } from '../src/server/config.ts';

const server = `http://localhost:${apiPort(process.env)}`;

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react()],
  build: {
    outDir: '../dist',
    emptyOutDir: true
  },
  server: {
    port: devWebPort(process.env),
    strictPort: true,
    proxy: { '/api': server, '/mcp': server }
  }
});
