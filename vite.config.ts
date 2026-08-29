import { defineConfig, configDefaults } from 'vitest/config'
import { loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

// https://vite.dev/config/
export default defineConfig(({ mode, command }) => {
  const env = loadEnv(mode, process.cwd(), '')

  // A missing VITE_SUPABASE_* fails loudly at runtime (supabaseClient.ts
  // throws). A missing VITE_VAPID_PUBLIC_KEY does not — usePushSubscription
  // just reports "unsupported" and the notification bell quietly never
  // appears, which looks like a UI bug rather than an unset build variable.
  // Warning here, at build time, is the one place that actually gets seen —
  // in the deploy log — before the feature ships silently broken.
  if (command === 'build' && !env.VITE_VAPID_PUBLIC_KEY) {
    console.warn(
      '\n⚠️  VITE_VAPID_PUBLIC_KEY is not set — Web Push notifications will be silently disabled in this build.\n' +
        '   Set it as a Cloudflare (or .env.local) build variable to enable them.\n'
    )
  }

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, './src'),
      },
    },
    test: {
      environment: 'node',
      exclude: [...configDefaults.exclude, 'e2e/**'],
    },
    server: { host: true },
  }
})
