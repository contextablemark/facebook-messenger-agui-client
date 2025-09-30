import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const rootDir = dirname(fileURLToPath(import.meta.url));

function resolvePath(relativePath: string): string {
  return resolve(rootDir, relativePath);
}

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['**/*.test.ts'],
    coverage: {
      reporter: ['text', 'lcov'],
      reportsDirectory: 'coverage',
    },
  },
  resolve: {
    alias: {
      '@agui-gw/fb-messenger': resolvePath('packages/fb-messenger/src/index.ts'),
      '@agui-gw/core': resolvePath('packages/core/src/index.ts'),
    },
  },
});
