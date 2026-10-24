import { DatabaseSync } from 'node:sqlite'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { handleVideoJob } from '#/server/jobs'
import type { VideoStatus } from '#/server/video/types'
import { d1Shim, migrate } from './d1-sqlite'

// 多步任务（yir 两步走）在轮询里进入下一步：jobs.ts 把新的服务商任务写回 generations，只写一次
const status = vi.fn<(requestId: string, meta: Record<string, unknown>) => Promise<VideoStatus>>()
vi.mock('#/server/video', () => ({ getVideoProvider: () => ({ id: 'yir', status, costCents: () => 0 }) }))
vi.mock('#/server/notifications', () => ({ notifyGenerationFinished: async () => {} }))

let sqlite: DatabaseSync
let sent: unknown[]
let env: Env

beforeEach(() => {
  sqlite = new DatabaseSync(':memory:')
  migrate(sqlite)
  sent = []
  env = { DB: d1Shim(sqlite), VIDEO_QUEUE: { send: async (message: unknown) => void sent.push(message) } } as unknown as Env
  const now = new Date().toISOString()
  sqlite.prepare('INSERT INTO users (id, email, credits, created_at) VALUES (?, ?, 0, ?)').run('usr_1', 'u@example.com', now)
  sqlite
    .prepare(
      `INSERT INTO generations (id, user_id, template_id, duration_id, duration_seconds, credits_cost, upload_id, status, provider,
       provider_request_id, provider_meta, created_at, updated_at) VALUES ('gen_1', 'usr_1', 't', 'short', 6, 6, 'upl_1', 'processing', 'yir', 'job_s', ?, ?, ?)`,
    )
    .run(JSON.stringify({ stage: 'scene' }), now, now)
  status.mockReset()
})

const row = () => sqlite.prepare('SELECT status, provider_request_id, provider_meta FROM generations WHERE id = ?').get('gen_1')
const advance = { state: 'pending', next: { requestId: 'job_v', meta: { stage: 'video', sceneCostCents: 1 } } } as const

describe('jobs：多步任务进入下一步', () => {
  it('provider 返回 next：之后轮询新任务，meta 换成下一步的', async () => {
    status.mockResolvedValue(advance)
    await handleVideoJob(env, { kind: 'poll', generationId: 'gen_1' })
    expect(status).toHaveBeenCalledWith('job_s', { stage: 'scene' })
    expect(row()).toEqual({ status: 'processing', provider_request_id: 'job_v', provider_meta: '{"stage":"video","sceneCostCents":1}' })
    expect(sent).toEqual([{ kind: 'poll', generationId: 'gen_1' }])
  })

  it('webhook 和定时轮询同时推进：晚到的一路按旧任务 id 抢占失败，不覆盖另一路写入的状态，也不多排一次轮询', async () => {
    status.mockImplementation(async () => {
      // 这一路查询期间，另一路已经推进并写入
      sqlite.prepare('UPDATE generations SET provider_request_id = ?, provider_meta = ? WHERE id = ?').run('job_v', '{"stage":"video"}', 'gen_1')
      return advance
    })
    await handleVideoJob(env, { kind: 'poll', generationId: 'gen_1' })
    expect(row()).toEqual({ status: 'processing', provider_request_id: 'job_v', provider_meta: '{"stage":"video"}' })
    expect(sent).toEqual([])
  })
})
