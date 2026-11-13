/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

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
  plugins: [
    react(),
    piperPhonemizeEsm(),
    VitePWA({
      // 'prompt' : pas de rechargement automatique (il couperait une génération en cours). Le nouveau service
      // worker s'active seul au prochain lancement ; l'app propose « Recharger » pour l'appliquer tout de suite.
      registerType: 'prompt',
      includeAssets: ['icons/apple-touch-icon.png'],
      manifest: {
        name: 'Lecteur de notes',
        short_name: 'Notes audio',
        description: 'Transforme tes notes de cours en balados audio, hors ligne.',
        lang: 'fr',
        display: 'standalone',
        start_url: '/Lecteur-note-audio/',
        scope: '/Lecteur-note-audio/',
        background_color: '#f6f5f2',
        theme_color: '#2f5fd0',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Coquille de l'app seulement (html/js/css/icônes, worker TTS). Les gros fichiers WASM/.data
        // ne sont pas préchargés : ils sont mis en cache à la première utilisation (voir runtimeCaching).
        globPatterns: ['**/*.{html,js,css,png,svg,webmanifest}'],
        globIgnores: ['**/*.wasm', '**/*.data', '**/pdf.worker*'],
        maximumFileSizeToCacheInBytes: 2 * 1024 * 1024,
        navigateFallback: '/Lecteur-note-audio/index.html',
        runtimeCaching: [
          {
            urlPattern: ({ url, sameOrigin }) =>
              sameOrigin && /\/assets\/.+\.(wasm|data)$|\/assets\/pdf\.worker[^/]*$/.test(url.pathname),
            handler: 'CacheFirst',
            options: { cacheName: 'lourds-fichiers', cacheableResponse: { statuses: [200] } },
          },
          {
            // OCR (tesseract.js) : cœur WASM, worker et données de langue, mis en cache après la première utilisation.
            urlPattern: ({ url }) => url.hostname === 'cdn.jsdelivr.net' || url.hostname === 'tessdata.projectnaptha.com',
            handler: 'CacheFirst',
            options: { cacheName: 'ocr-cdn', cacheableResponse: { statuses: [200] } },
          },
        ],
      },
    }),
  ],
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
