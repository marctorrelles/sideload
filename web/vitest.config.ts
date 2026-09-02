import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { environment: 'node', include: ['test/**/*.test.ts'] }, resolve: { alias: { '@shared': new URL('../shared', import.meta.url).pathname } } });
