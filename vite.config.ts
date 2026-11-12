/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * piper_phonemize.js (Emscripten, UMD/CommonJS) → module ES : on retire les require()
 * des branches Node (jamais exécutées dans le worker) et on ajoute un export par défaut.
 */
function piperPhonemizeEsm(): Plugin {
  return {
    name: 'piper-phonemize-esm',
    enforce: 'pre',
    transform(code, id) {
      if (!id.split('?')[0].endsWith('/piper-wasm/build/piper_phonemize.js')) return null;
      const out = code.replace(/require\("(fs|path|crypto)"\)/g, 'undefined');
      return { code: `${out}\nexport default createPiperPhonemize;\n`, map: null };
    },
  };
}

export default defineConfig({
  base: '/Lecteur-note-audio/',
  plugins: [react(), piperPhonemizeEsm()],
  // pdf.js (~501 Ko) est chargé à la demande avec le module d'import : pas dans le bundle initial.
  build: { chunkSizeWarningLimit: 600 },
  // Worker Piper en module ES, avec la même transformation du phonémiseur.
  worker: { format: 'es', plugins: () => [piperPhonemizeEsm()] },
  // Pas de pré-bundling esbuild : le plugin ci-dessus doit voir le fichier en dev aussi.
  optimizeDeps: { exclude: ['@diffusionstudio/piper-wasm'] },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}'],
  },
});
