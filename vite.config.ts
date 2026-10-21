import { cloudflare } from '@cloudflare/vite-plugin'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import tailwindcss from '@tailwindcss/vite'
import viteReact from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// 支付商 sandbox e2e（playwright.sandbox.config.ts）用这两个变量切换支付商和回跳地址，不用改 .dev.vars。只对 dev server 生效，不会进构建产物
const sandboxProvider = process.env.SANDBOX_PAYMENT_PROVIDER
const sandboxSiteUrl = process.env.SANDBOX_SITE_URL

export default defineConfig(({ command, mode }) => ({
  resolve: { tsconfigPaths: true },
  // .tmp 下有 Playwright HTML report，不忽略的话写报告会触发页面整页刷新，干扰正在跑的 e2e
  server: { watch: { ignored: ['**/.tmp/**'] } },
  plugins: [
    // vite build --mode staging 改用 workers.dev 预发配置；产物里的 dist/server/wrangler.json 随之切换，wrangler deploy 直接读取它
    cloudflare({
      viteEnvironment: { name: 'ssr' },
      configPath: mode === 'staging' ? 'wrangler.staging.jsonc' : undefined,
      config:
        command === 'serve' && sandboxProvider && sandboxSiteUrl
          ? (worker) => ({ vars: { ...worker.vars, PAYMENT_PROVIDER: sandboxProvider, SITE_URL: sandboxSiteUrl } })
          : undefined,
    }),
    tailwindcss(),
    tanstackStart(),
    viteReact(),
  ],
}))
