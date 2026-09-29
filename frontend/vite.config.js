import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  base: process.env.GH_PAGES ? '/parkscan-nl/' : '/',
  define: { 'process.env': '({})' },
  resolve: {
    alias: {
      '@google-cloud/vertexai': path.resolve('src/lib/demo/vertexStub.js'),
      '@google-cloud/vision': path.resolve('src/lib/demo/vertexStub.js'),
    },
  },
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.js',
  },
});
