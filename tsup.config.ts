import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  outExtension: (ctx) => ({
    js: ctx.format === 'esm' ? '.mjs' : '.cjs'
  })
});
