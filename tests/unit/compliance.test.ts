import { describe, expect, it, vi } from 'vitest'
import { createOpenAiModeration, getModerationProvider } from '#/server/moderation'
import { verifyTurnstile } from '#/server/turnstile'
import { ApiError } from '#/server/util'

const env = (vars: Record<string, string>) => vars as unknown as Env
const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

async function apiError(promise: Promise<unknown>) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  )
  expect(error).toBeInstanceOf(ApiError)
  return { status: (error as ApiError).status, code: (error as ApiError).code }
}

// token 单次有效；校验失败、配置缺失、Cloudflare 不可达必须是不同的错误码，前端据此提示
describe('verifyTurnstile', () => {
  const enabled = env({ TURNSTILE_SITE_KEY: 'site', TURNSTILE_SECRET_KEY: 'secret' })

  it('未配置站点密钥时不校验，也不发请求', async () => {
    const fetcher = vi.fn<typeof fetch>()
    await verifyTurnstile(env({ TURNSTILE_SITE_KEY: ' ' }), undefined, undefined, fetcher)
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('启用但缺 secret 时拒绝服务，而不是放行', async () => {
    const fetcher = vi.fn<typeof fetch>()
    expect(await apiError(verifyTurnstile(env({ TURNSTILE_SITE_KEY: 'site' }), 'tok', undefined, fetcher))).toEqual({
      status: 503,
      code: 'captcha_not_configured',
    })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('缺 token 或超长 token 直接 400', async () => {
    const fetcher = vi.fn<typeof fetch>()
    expect((await apiError(verifyTurnstile(enabled, '', undefined, fetcher))).code).toBe('captcha_required')
    expect((await apiError(verifyTurnstile(enabled, 'x'.repeat(2049), undefined, fetcher))).code).toBe('captcha_required')
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('把 secret、token、IP 发给 siteverify，success 时通过', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => jsonResponse({ success: true }))
    await verifyTurnstile(enabled, 'tok', '203.0.113.9', fetcher)
    const [url, init] = fetcher.mock.calls[0]!
    expect(url).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify')
    const body = init!.body as FormData
    expect([body.get('secret'), body.get('response'), body.get('remoteip')]).toEqual(['secret', 'tok', '203.0.113.9'])
  })

  it('校验不通过 → captcha_failed；网络/HTTP 错误 → captcha_unavailable', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const rejected = vi.fn<typeof fetch>(async () => jsonResponse({ success: false, 'error-codes': ['timeout-or-duplicate'] }))
    expect(await apiError(verifyTurnstile(enabled, 'tok', undefined, rejected))).toEqual({ status: 400, code: 'captcha_failed' })
    const down = vi.fn<typeof fetch>(async () => new Response('bad gateway', { status: 502 }))
    expect(await apiError(verifyTurnstile(enabled, 'tok', undefined, down))).toEqual({ status: 503, code: 'captcha_unavailable' })
    const offline = vi.fn<typeof fetch>(async () => {
      throw new TypeError('fetch failed')
    })
    expect((await apiError(verifyTurnstile(enabled, 'tok', undefined, offline))).code).toBe('captcha_unavailable')
  })
})

describe('OpenAI 图片审核', () => {
  const image = { bytes: new Uint8Array([1, 2, 3]), contentType: 'image/png' }

  it('以 data URL 提交图片，命中图片类别时拒绝并给出原因', async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      jsonResponse({ results: [{ flagged: true, categories: { sexual: true, violence: true, 'self-harm/intent': true } }] }),
    )
    const verdict = await createOpenAiModeration('sk-test', fetcher).checkImage(image)
    // violence（非 graphic）不拦截：生成类玩法常见轻度动作
    expect(verdict).toEqual({ allowed: false, reason: 'sexual,self-harm/intent' })
    const body = JSON.parse(fetcher.mock.calls[0]![1]!.body as string)
    expect(body.model).toBe('omni-moderation-latest')
    expect(body.input[0].image_url.url).toBe('data:image/png;base64,AQID')
  })

  it('干净图片放行', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => jsonResponse({ results: [{ flagged: false, categories: { sexual: false } }] }))
    expect(await createOpenAiModeration('sk-test', fetcher).checkImage(image)).toEqual({ allowed: true })
  })

  it('接口失败或返回异常时 fail closed（503），不放行', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const down = vi.fn<typeof fetch>(async () => new Response('rate limited', { status: 429 }))
    expect(await apiError(createOpenAiModeration('sk-test', down).checkImage(image))).toEqual({ status: 503, code: 'moderation_unavailable' })
    const empty = vi.fn<typeof fetch>(async () => jsonResponse({ results: [] }))
    expect((await apiError(createOpenAiModeration('sk-test', empty).checkImage(image))).code).toBe('moderation_unavailable')
  })
})

describe('审核 provider 选择', () => {
  it('生产环境拒绝 mock；openai 缺 key 时拒绝', () => {
    expect(() => getModerationProvider(env({ APP_ENV: 'production', MODERATION_PROVIDER: 'mock' }))).toThrow(ApiError)
    expect(() => getModerationProvider(env({ APP_ENV: 'production', MODERATION_PROVIDER: 'openai' }))).toThrow(/OPENAI_API_KEY/)
    expect(getModerationProvider(env({ APP_ENV: 'development', MODERATION_PROVIDER: 'mock' })).id).toBe('mock')
    expect(getModerationProvider(env({ APP_ENV: 'production', MODERATION_PROVIDER: 'openai', OPENAI_API_KEY: 'sk-x' })).id).toBe('openai')
  })
})
