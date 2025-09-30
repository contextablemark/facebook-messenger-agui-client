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
      '@agui/messaging-sdk': resolvePath('packages/messaging-sdk/src/index.ts'),
      '@agui-gw/core': resolvePath('packages/gateway-core/src/index.ts'),
    },
  },
});
