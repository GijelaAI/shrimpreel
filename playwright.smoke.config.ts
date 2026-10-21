import { defineConfig, devices } from '@playwright/test'

// 上线后的只读巡检：不起本地服务、不登录、不写数据，只对 SMOKE_BASE_URL 发 GET 和必然被拒的 POST
//   SMOKE_BASE_URL=https://moonhop.ai npm run test:smoke
//   SMOKE_BASE_URL=https://xxx-staging.<子域名>.workers.dev SMOKE_EXPECT=staging npm run test:smoke
const ARTIFACTS = '.tmp/smoke-prod'
const BASE_URL = process.env.SMOKE_BASE_URL
if (!BASE_URL) throw new Error('缺少 SMOKE_BASE_URL（要巡检的站点地址，例如 https://moonhop.ai）')

export default defineConfig({
  testDir: 'tests/smoke',
  outputDir: `${ARTIFACTS}/test-results`,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  workers: 2,
  retries: 1,
  reporter: [
    ['list'],
    ['html', { outputFolder: `${ARTIFACTS}/report`, open: 'never' }],
    ['json', { outputFile: `${ARTIFACTS}/results.json` }],
  ],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    locale: 'en-US',
    // 本机生产模式预览用 wrangler dev --local-protocol https 的自签证书
    ignoreHTTPSErrors: ['127.0.0.1', 'localhost'].includes(new URL(BASE_URL).hostname),
  },
  // UA 带 bot 标识：页面加载时的访问归因（/api/t/visit）跳过爬虫，巡检不计入访问报表
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], userAgent: `${devices['Desktop Chrome'].userAgent} ShrimpReelSmoke/1.0 (bot)` } }],
})
