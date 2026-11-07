import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig(({ command }) => ({
  plugins: [react()],
  // Nothing environment-specific goes in the build: /config.json is written next to
  // the bundle at deploy time. For `npm run dev`, put a config.json in the gitignored
  // dev/ folder (see config.example.json). It is served by the dev server only.
  publicDir: command === 'serve' ? 'dev' : false,
  server: {
    // Must match the Cognito dev callback URL (http://localhost:5173).
    port: 5173,
    strictPort: true,
  },
  build: {
    sourcemap: false,
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/test/setup.ts'],
    restoreMocks: true,
  },
}));
