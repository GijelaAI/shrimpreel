import { describe, expect, it } from 'vitest'
import { summarizeClientError } from '#/server/client-error'

describe('summarizeClientError', () => {
  it('邮箱打码，URL 去掉账号密码、query 和 hash 但保留行列号，堆栈只留前 6 行', () => {
    const frames = Array.from({ length: 9 }, (_, i) => `    at f${i} (https://user:pass@example.test/assets/main-abc.js${i % 2 ? '?v=1' : ''}:${i + 10}:5)`)
    const raw = JSON.stringify({
      id: 'a1b2c3d4e5f6',
      kind: 'boundary',
      message: 'TypeError: cannot read order of buyer.name+tag@example.co.uk at https://example.test/checkout/success?email=x%40y.test',
      stack: ['TypeError: boom', ...frames].join('\n'),
      page: 'https://example.test/checkout/success?email=buyer%40example.test#paid',
    })
    expect(summarizeClientError(raw)).toBe(
      'id=a1b2c3d4e5f6 kind=boundary page=https://example.test/checkout/success ' +
        'message="TypeError: cannot read order of [email] at https://example.test/checkout/success" ' +
        'stack=TypeError: boom | at f0 (https://example.test/assets/main-abc.js:10:5) | at f1 (https://example.test/assets/main-abc.js:11:5) | ' +
        'at f2 (https://example.test/assets/main-abc.js:12:5) | at f3 (https://example.test/assets/main-abc.js:13:5) | at f4 (https://example.test/assets/main-abc.js:14:5)',
    )
  })

  it('非 JSON、null、编号或类型不合法时不输出', () => {
    const ok = { id: 'a1b2c3d4e5f6', kind: 'error', message: 'x', page: 'https://example.test/' }
    for (const raw of ['not json', '', 'null', '[]', JSON.stringify({ ...ok, id: 'x' }), JSON.stringify({ ...ok, id: 'a1b2c3d4 e5f6' }), JSON.stringify({ ...ok, kind: 'debug' })]) {
      expect(summarizeClientError(raw), raw).toBeNull()
    }
    expect(summarizeClientError(JSON.stringify(ok))).toBe('id=a1b2c3d4e5f6 kind=error page=https://example.test/ message="x"')
  })
})
