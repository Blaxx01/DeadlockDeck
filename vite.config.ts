import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// GitHub Pages serviert das Projekt unter /<Repo-Name>/
const base = process.env.BASE_PATH ?? '/DeadlockDeck/'

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'DeadlockDeck',
        short_name: 'DeadlockDeck',
        description: 'Deadlock-Items lernen mit Karteikarten',
        lang: 'de',
        theme_color: '#0f0d0b',
        background_color: '#0f0d0b',
        display: 'standalone',
        orientation: 'portrait',
        start_url: base,
        scope: base,
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
        runtimeCaching: [
          {
            // Item-/Hero-Bilder vom Deadlock-API-CDN: einmal laden, dann aus dem Cache
            urlPattern: ({ url }) => url.hostname.endsWith('deadlock-api.com') && /\.(png|webp|jpe?g|svg)$/i.test(url.pathname),
            handler: 'CacheFirst',
            options: {
              cacheName: 'deadlock-images',
              cacheableResponse: { statuses: [0, 200] },
              // Vorgeladen wird per CORS, <img> fragt ohne – "Vary: Origin" darf den Treffer nicht verhindern
              matchOptions: { ignoreVary: true },
              expiration: { maxEntries: 2000, maxAgeSeconds: 60 * 60 * 24 * 180 },
            },
          },
        ],
      },
    }),
  ],
})
