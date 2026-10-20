import { readFileSync } from 'node:fs'
import { expect, type APIRequestContext, type APIResponse } from '@playwright/test'
import { site } from '../../src/config/site'
import { en } from '../../src/content/en'
import { zh } from '../../src/content/zh'

// 3000 被占用时用 E2E_PORT 换端口（与 playwright.config.ts 一致）
export const ORIGIN = `http://127.0.0.1:${process.env.E2E_PORT ?? '3000'}`
export const PHOTO = 'tests/fixtures/photo.jpg'

// 页面文案（站点里按语言懒加载，测试直接调用文案工厂）
export const content = { en: en(site), zh: zh(site) }

export function uniqueEmail(tag: string) {
  return `e2e-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.com`
}

// 写接口有同源校验（CSRF），APIRequestContext 默认不带 Origin，这里统一补上
export function post(request: APIRequestContext, path: string, data?: unknown) {
  return request.post(path, { data, headers: { origin: ORIGIN } })
}

export async function json<T>(response: APIResponse | Promise<APIResponse>, status = 200): Promise<T> {
  const res = await response
  expect(res.status(), `${res.url()} → ${await res.text()}`).toBe(status)
  return (await res.json()) as T
}

export async function devLogin(request: APIRequestContext, email: string) {
  const data = await json<{ user: { id: string; email: string; credits: number; role: string } }>(
    post(request, '/api/auth/dev-login', { email }),
  )
  return data.user
}

export async function credits(request: APIRequestContext) {
  const data = await json<{ user: { credits: number } | null }>(request.get('/api/me'))
  return data.user!.credits
}

export async function ledger(request: APIRequestContext) {
  const data = await json<{ balance: number; entries: Array<{ delta: number; reason: string; ref_id: string | null }> }>(
    request.get('/api/credits/ledger'),
  )
  return data.entries
}

// 走真实下单接口 + mock 回调，与真实 webhook 共用入账逻辑
export async function buyPackage(request: APIRequestContext, packageId: string) {
  const { orderId } = await json<{ orderId: string; url: string }>(post(request, '/api/checkout', { packageId, locale: 'en' }))
  await json(post(request, '/api/mock-payments/complete', { orderId, outcome: 'paid' }))
  return orderId
}

export async function uploadPhoto(request: APIRequestContext, buffer = readFileSync(PHOTO), mimeType = 'image/jpeg') {
  return request.post('/api/uploads', {
    headers: { origin: ORIGIN },
    multipart: { file: { name: 'photo.jpg', mimeType, buffer } },
  })
}
