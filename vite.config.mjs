import { defineConfig } from 'vite';

export default defineConfig({
  root: 'src/renderer',
  base: './',
  // src/assets sits outside the Vite root. It is copied verbatim so the built
  // app always ships the local character model; nothing is fetched at runtime.
  publicDir: '../assets',
  build: {
    outDir: '../../dist/renderer',
    emptyOutDir: true,
  },
});
