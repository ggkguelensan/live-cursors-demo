import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@effector/reflect/imperative': fileURLToPath(
        new URL('./src/vendor/reflect/imperative.ts', import.meta.url),
      ),
    },
    dedupe: ['react', 'react-dom', 'effector', 'effector-react', 'yjs'],
  },
});
