import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron'
import renderer from 'vite-plugin-electron-renderer'
import path from 'path'
import { startDevelopmentElectron } from './scripts/developmentElectron'

const electronExternals = [
  'electron',
  'sql.js',
  'tesseract.js',
  'electron-store',
  '@hono/node-server',
  'hono',
  /^@modelcontextprotocol\/sdk(?:\/|$)/,
  'zod',
  'path',
  'fs',
  'crypto',
  'os',
  'url',
  'child_process',
  'stream',
  'http',
  'https',
  'net',
  'node:net',
  'tls',
  'zlib',
  'events',
  'buffer',
  'util',
  'assert',
]

export default defineConfig({
  plugins: [
    react(),
    electron([
      {
        // 메인 프로세스 + 서버
        entry: 'electron/main.ts',
        async onstart(options) {
          await startDevelopmentElectron(options.startup)
        },
        vite: {
          build: {
            outDir: 'dist-electron',
            sourcemap: true,
            rollupOptions: {
              external: electronExternals,
              output: { format: 'cjs' }
            }
          },
          resolve: {
            alias: { '@': path.resolve(__dirname, './src') }
          }
        }
      },
      {
        // 프리로드
        entry: ['electron/preload.ts', 'electron/noteToastPreload.ts'],
        onstart(options) {
          options.reload()
        },
        vite: {
          build: {
            outDir: 'dist-electron',
            sourcemap: true,
            rollupOptions: {
              external: ['electron'],
              output: { format: 'cjs' }
            }
          }
        }
      }
    ]),
    renderer()
  ],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') }
  },
  publicDir: 'public',
  build: {
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html'),
        overlay: path.resolve(__dirname, 'overlay.html'),
        'quick-switch': path.resolve(__dirname, 'quick-switch.html')
      }
    }
  }
})
