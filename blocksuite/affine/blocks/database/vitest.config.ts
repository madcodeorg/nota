import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/__tests__/**/*.unit.spec.ts'],
    environment: 'happy-dom',
    testTimeout: 5000,
  },
});
