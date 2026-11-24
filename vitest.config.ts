import { defineConfig } from 'vitest/config';
import { WxtVitest } from 'wxt/testing/vitest-plugin';

export default defineConfig({
  plugins: [WxtVitest()],
  test: {
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
    exclude: ['tests/lint-fixtures/**', 'tests/e2e/**', 'node_modules/**'],
    // §5.5：日期測試在台灣時區跑，確認不受本機時區影響。
    env: { TZ: 'Asia/Taipei' },
    testTimeout: 30_000,
  },
});
