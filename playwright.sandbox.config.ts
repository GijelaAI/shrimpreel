import { defineConfig, devices } from '@playwright/test'

// 支付商 sandbox e2e：真实 test 模式收银台和测试卡，需要 .dev.vars 里的 test 凭据，默认不进 CI。
// 用法见 docs/payments.md 的“sandbox e2e”。一次只跑一家：SANDBOX_PROVIDER=dodo|waffo|stripe npm run test:sandbox
const PROVIDER = process.env.SANDBOX_PROVIDER
if (PROVIDER !== 'dodo' && PROVIDER !== 'waffo' && PROVIDER !== 'stripe') throw new Error('设置 SANDBOX_PROVIDER=dodo、waffo 或 stripe')

const ARTIFACTS = `.tmp/sandbox-e2e/${PROVIDER}`
const PORT = process.env.E2E_PORT ?? '3000'
const BASE_URL = `http://127.0.0.1:${PORT}`

export default defineConfig({
  testDir: 'tests/sandbox',
  testMatch: `${PROVIDER}.spec.ts`,
  outputDir: `${ARTIFACTS}/test-results`,
  // 收银台是第三方页面，加载和跳转都慢；入账可能要等到成功页第 15 秒的查单
  timeout: 5 * 60_000,
  expect: { timeout: 30_000 },
  workers: 1,
  reporter: [
    ['list'],
    ['html', { outputFolder: `${ARTIFACTS}/report`, open: 'never' }],
    ['json', { outputFile: `${ARTIFACTS}/results.json` }],
  ],
  use: {
    baseURL: BASE_URL,
    trace: 'on',
    screenshot: 'on',
    locale: 'en-US',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // 必须自己起 dev server：vite.config.ts 读这两个变量切换支付商和回跳地址。已有 server 占着端口时直接报错，不会误连到 mock
  webServer: {
    command: `npx vite dev --port ${PORT} --strictPort --host 127.0.0.1`,
    url: `${BASE_URL}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: { SANDBOX_PAYMENT_PROVIDER: PROVIDER, SANDBOX_SITE_URL: BASE_URL },
  },
})
