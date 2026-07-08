import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// GitHub Pages: https://<user>.github.io/carrender/
export default defineConfig({
  base: '/carrender/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/apple-touch-icon.png', 'icons/icon.svg'],
      manifest: {
        name: 'StudyCommander 学習司令塔',
        short_name: 'StudyCmdr',
        description: '試験日から逆算して毎日の勉強計画を自動再設計する学習司令塔',
        lang: 'ja',
        start_url: '/carrender/',
        scope: '/carrender/',
        display: 'standalone',
        orientation: 'portrait',
        theme_color: '#0b0f1a',
        background_color: '#0b0f1a',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
        navigateFallback: '/carrender/index.html',
        cleanupOutdatedCaches: true
      }
    })
  ],
  build: {
    target: 'es2020'
  }
});
