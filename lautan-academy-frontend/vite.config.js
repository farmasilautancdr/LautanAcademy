import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    vue(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon-192.png', 'icon-512.png'],
      manifest: {
        name: 'Lautan Academy',
        short_name: 'Lautan Academy',
        description: 'Staff training and quiz platform for Farmasi Lautan',
        start_url: '/',
        display: 'standalone',
        background_color: '#F1F6FA',
        theme_color: '#0E3A5C',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // API calls go to a different origin (Railway) — never cache those,
        // only the app shell itself needs offline/install support.
        navigateFallbackDenylist: [/^\/api\//],
        // ExcelJS (Supervisor report export) is lazy dynamic-imported
        // specifically so most roles never fetch its ~270KB chunk —
        // precaching it here on install would silently undo that for
        // every installed-PWA user regardless of role. Fetched from
        // network on the one occasion it's actually needed instead.
        globIgnores: ['**/exceljs.min-*.js'],
      },
    }),
  ],
  server: { port: 5173 },
  optimizeDeps: { exclude: ['exceljs'] },
})
