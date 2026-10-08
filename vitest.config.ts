import { defineConfig } from 'vitest/config';

// Las pruebas unitarias viven en src/; e2e/ es de Playwright (npm run test:e2e)
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
  },
});
