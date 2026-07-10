import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The client lives in ./client and builds into ./server/public,
// which the Express server serves statically in production.
export default defineConfig({
  root: 'client',
  plugins: [react()],
  build: {
    outDir: '../server/public',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    // In dev, proxy API calls to the Express server so the Groq key
    // stays server-side and the browser talks to one origin.
    proxy: {
      '/api/generate': 'http://localhost:3001',
      '/api/health': 'http://localhost:3001',
    },
  },
});
