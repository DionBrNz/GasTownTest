import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    // Handlers land in to-oti.3; until then there is nothing to test.
    passWithNoTests: true,
  },
});
