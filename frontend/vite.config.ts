import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { APP_VERSION, REPO_ROOT } from './app-version.mjs'

// Die Version wird beim Bauen aus backend/app/main.py gelesen (siehe
// app-version.mjs). ⚠️ Docker: die Frontend-Stage bekommt nur `frontend/`, die
// Datei wird daher im Dockerfile ausdrücklich hineinkopiert — gleicher Grund
// und gleiche Form wie bei `contracts/`.

// FastAPI dev server runs on :8000; proxy /api there during dev. Override with
// CUE_API_TARGET when that port is already taken by something else.
const apiTarget = process.env.CUE_API_TARGET || 'http://127.0.0.1:8000'
export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(APP_VERSION),
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'cue — Prompt Queue',
        short_name: 'cue',
        description: 'Prompt-Queue für Claude-Code-Sessions',
        theme_color: '#6750A4',
        background_color: '#141218',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        navigateFallbackDenylist: [/^\/api/],
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // Landing screenshots are only shown pre-login — don't bloat the PWA cache.
        globIgnores: ['**/landing/**', '**/og.png'],
        // Der Changelog ist ein eigener Chunk (~36 kB gzip), der nur geladen
        // wird, wenn jemand ihn in „Über cue" aufklappt — ohne diese Regel zöge
        // ihn der Service Worker trotz des dynamischen Imports bei jedem
        // Erstbesuch mit (gemessen: Precache 1131 → 1221 KiB).
        //
        // ⚠️ Hier NICHT über `globIgnores`: `**/CHANGELOG-*.js` schloss den
        // Chunk auf macOS aus und auf dem Linux-Build-Host NICHT — die
        // Glob-Auflösung hängt an der Groß-/Kleinschreibung des Dateisystems,
        // und es gibt zwei Chunks, die sich nur darin unterscheiden
        // (`CHANGELOG-*.js` = die Daten, `changelog-*.js` = der Parser). Lokal
        // grün, im Image drin — genau die Sorte Unterschied, die man erst in
        // Produktion sieht. Eine Filterfunktion ist auf beiden Systemen dasselbe.
        manifestTransforms: [
          (entries) => ({
            manifest: entries.filter((e) => !/changelog-[^/]*\.js$/i.test(e.url)),
            warnings: [],
          }),
        ],
      },
    }),
  ],
  server: {
    port: 5173,
    // CHANGELOG.md is imported raw from the repo root (see lib/changelog.ts);
    // without this the dev server refuses to serve a file above `frontend/`.
    fs: { allow: [REPO_ROOT] },
    proxy: {
      '/api': { target: apiTarget, changeOrigin: false },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
})
