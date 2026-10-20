import type { FullConfig } from '@playwright/test'

// mock 生成会直接复用 R2 里的模板源视频；没 seed 时尽早给出明确提示
export default async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0]!.use.baseURL!
  const response = await fetch(`${baseURL}/media/templates/neon-shuffle-v1-6s.mp4`, { method: 'HEAD' })
  if (!response.ok) {
    throw new Error(`模板视频不可用（HTTP ${response.status}），请先运行 npm run seed:local`)
  }
}
