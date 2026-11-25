import { defineConfig } from 'vitest/config';

// Fast tests of plain functions (no browser): `npm test`. Everything is worked out in Manila time, whatever the
// computer's own timezone, so the tests pin a different one to prove it.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    env: { TZ: 'America/New_York' },
  },
});
