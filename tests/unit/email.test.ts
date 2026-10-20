import { describe, expect, it, vi } from 'vitest'
import { site } from '#/config/site'
import { EMAIL_MAX_ATTEMPTS, attemptDelivery, emailConfig, type EmailConfig, type Mailer } from '#/server/email'
import { renderEmail } from '#/server/email-templates'

const SITE_URL = 'https://example.test/'
const NOW = Date.parse('2026-10-20T00:00:00.000Z')

function config(send: Mailer['send']): EmailConfig {
  return { mailer: { send: vi.fn(send) }, from: { email: 'noreply@example.test', name: site.brandName }, siteUrl: SITE_URL }
}

function row(overrides: Partial<{ template: string; params: string; locale: string; attempts: number }> = {}) {
  return {
    template: 'order_paid',
    to_email: 'buyer@example.test',
    locale: 'en',
    params: JSON.stringify({ orderId: 'ord_1', credits: 60, amount: '$19.90' }),
    attempts: 1,
    ...overrides,
  }
}

function sendError(code: string | null, message = 'boom') {
  return Object.assign(new Error(message), code ? { code } : {})
}

describe('renderEmail', () => {
  it('按 locale 选择语言和带前缀的链接，未知语言回退英文', () => {
    const zh = renderEmail('generation_failed', { generationId: 'gen_1', credits: 6 }, { siteUrl: SITE_URL, locale: 'zh' })
    expect(zh.subject).toContain('积分已退回')
    expect(zh.text).toContain('6 个积分已退回')
    expect(zh.text).toContain('重新生成: https://example.test/zh\n')

    const fallback = renderEmail('generation_failed', { generationId: 'gen_1', credits: 6 }, { siteUrl: SITE_URL, locale: 'fr' })
    expect(fallback.subject).toContain('credits refunded')
    expect(fallback.text).toContain('Try again: https://example.test/')
    expect(fallback.text).not.toContain('/zh/')
  })

  it('用户输入只出现在正文且 HTML 转义，不进 Subject；留言提醒的 replyTo 是留言人', () => {
    const message = '<img src=x onerror=alert(1)> & "quotes"\nline 2'
    const mail = renderEmail(
      'admin_contact',
      { messageId: 'msg_1', topic: 'billing', email: 'visitor@example.test', message },
      { siteUrl: SITE_URL, locale: 'zh' },
    )
    expect(mail.subject).toBe(`[${site.brandName}] 新留言：账单`)
    expect(mail.subject).not.toContain('visitor@')
    expect(mail.html).not.toContain('<img')
    expect(mail.html).toContain('&lt;img src=x onerror=alert(1)&gt; &amp; &quot;quotes&quot;')
    expect(mail.text).toContain(message)
    expect(mail.replyTo).toBe('visitor@example.test')

    const receipt = renderEmail('takedown_received', { reportId: 'tdr_1', dueAt: '2026-10-22T00:00:00.000Z' }, { siteUrl: SITE_URL, locale: 'en' })
    expect(receipt.replyTo).toBe(site.supportEmail)
  })

  it('Subject 去掉换行，防止邮件头注入', () => {
    const mail = renderEmail(
      'takedown_resolved',
      { reportId: 'tdr_1\r\nBcc: victim@example.test', outcome: 'rejected' },
      { siteUrl: SITE_URL, locale: 'en' },
    )
    expect(mail.subject).not.toMatch(/[\r\n]/)
  })

  it('管理员提醒固定中文，并带上超时阶段', () => {
    const mail = renderEmail(
      'admin_takedown',
      { reportId: 'tdr_9', stage: 'overdue', reason: 'intimate', generationId: null, dueAt: '2026-10-22T00:00:00.000Z' },
      { siteUrl: SITE_URL, locale: 'en' },
    )
    expect(mail.subject).toBe(`[${site.brandName}] 举报已超时：tdr_9`)
    expect(mail.text).toContain('私密影像')
    expect(mail.text).toContain('未能自动定位')
    expect(mail.text).toContain('https://example.test/admin/takedowns')
  })
})

describe('emailConfig', () => {
  const binding = { send: async () => ({ messageId: 'x' }) } as unknown as SendEmail
  it('缺发件地址或 binding 时视为未配置（记为 skipped，不发信）', () => {
    expect(emailConfig({ EMAIL_FROM: '', EMAIL: binding, SITE_URL } as Env)).toBeNull()
    expect(emailConfig({ EMAIL_FROM: '   ', EMAIL: binding, SITE_URL } as Env)).toBeNull()
    expect(emailConfig({ EMAIL_FROM: 'noreply@example.test', SITE_URL } as unknown as Env)).toBeNull()
    expect(emailConfig({ EMAIL_FROM: ' noreply@example.test ', EMAIL: binding, SITE_URL } as Env)?.from.email).toBe('noreply@example.test')
  })
})

describe('attemptDelivery', () => {
  it('发送成功：带上发件人、渲染后的主题和 replyTo', async () => {
    const cfg = config(async () => ({ messageId: 'msg-123' }))
    const result = await attemptDelivery(row(), cfg, NOW)
    expect(result).toEqual({ status: 'sent', subject: `60 credits added to your ${site.brandName} account`, messageId: 'msg-123' })
    expect(cfg.mailer.send).toHaveBeenCalledWith(
      expect.objectContaining({ from: cfg.from, to: 'buyer@example.test', replyTo: site.supportEmail, subject: result.subject }),
    )
  })

  it('临时错误（限流、配额、内部错误、无错误码的网络错误）按 5/15/45 分钟退避重试', async () => {
    for (const [code, attempts, minutes] of [
      ['E_RATE_LIMIT_EXCEEDED', 1, 5],
      ['E_DAILY_LIMIT_EXCEEDED', 2, 15],
      ['E_INTERNAL_SERVER_ERROR', 3, 45],
      [null, 1, 5],
    ] as const) {
      const result = await attemptDelivery(row({ attempts }), config(async () => Promise.reject(sendError(code))), NOW)
      expect(result.status).toBe('pending')
      expect(result).toMatchObject({ retryAt: new Date(NOW + minutes * 60_000).toISOString() })
      expect(result.status !== 'sent' && result.error).toContain(code ?? 'send_failed')
    }
  })

  it('永久错误直接失败，不再重试', async () => {
    for (const code of ['E_SENDER_NOT_VERIFIED', 'E_SENDER_DOMAIN_NOT_AVAILABLE', 'E_RECIPIENT_SUPPRESSED', 'E_VALIDATION_ERROR']) {
      const result = await attemptDelivery(row(), config(async () => Promise.reject(sendError(code))), NOW)
      expect(result).toMatchObject({ status: 'failed', retryAt: null })
    }
  })

  it(`第 ${EMAIL_MAX_ATTEMPTS} 次仍是临时错误：判为失败`, async () => {
    const cfg = config(async () => Promise.reject(sendError('E_RATE_LIMIT_EXCEEDED')))
    expect(await attemptDelivery(row({ attempts: EMAIL_MAX_ATTEMPTS - 1 }), cfg, NOW)).toMatchObject({ status: 'pending' })
    expect(await attemptDelivery(row({ attempts: EMAIL_MAX_ATTEMPTS }), cfg, NOW)).toMatchObject({ status: 'failed', retryAt: null })
  })

  it('模板不存在或参数损坏：直接失败且不调用发信', async () => {
    const cfg = config(async () => ({ messageId: 'never' }))
    expect(await attemptDelivery(row({ template: 'nope' }), cfg, NOW)).toMatchObject({ status: 'failed', error: 'unknown_template' })
    expect(await attemptDelivery(row({ params: '{broken' }), cfg, NOW)).toMatchObject({ status: 'failed' })
    expect(cfg.mailer.send).not.toHaveBeenCalled()
  })
})
