// 浏览器端调用 /api/*：统一 JSON 解析与错误码
export class ApiRequestError extends Error {
  constructor(
    public status: number,
    public code: string,
    message?: string,
  ) {
    super(message ?? code)
  }
}

type Options = {
  method?: 'GET' | 'POST' | 'DELETE'
  json?: unknown
  form?: FormData
  signal?: AbortSignal
}

export async function api<T>(path: string, options: Options = {}): Promise<T> {
  const init: RequestInit = {
    method: options.method ?? (options.json !== undefined || options.form ? 'POST' : 'GET'),
    credentials: 'same-origin',
    signal: options.signal,
  }
  if (options.form) init.body = options.form
  else if (options.json !== undefined) {
    init.body = JSON.stringify(options.json)
    init.headers = { 'Content-Type': 'application/json' }
  }
  const response = await fetch(path, init)
  const data = (await response.json().catch(() => null)) as { error?: string; message?: string } | null
  if (!response.ok) throw new ApiRequestError(response.status, data?.error ?? `http_${response.status}`, data?.message)
  return data as T
}

export function errorCode(error: unknown) {
  if (error instanceof ApiRequestError) return error.code
  if (error instanceof DOMException && error.name === 'AbortError') return 'aborted'
  return 'network_error'
}

// ---------- 与服务端 publicUser / publicGeneration / publicOrder 对齐的类型 ----------

export type PublicUser = {
  id: string
  email: string
  name: string | null
  avatarUrl: string | null
  role: 'user' | 'admin'
  credits: number
  createdAt: string
}

export type ClientConfig = {
  googleClientId: string | null
  devLogin: boolean
  paymentProvider: string
  turnstileSiteKey: string | null
}

export type Generation = {
  id: string
  templateId: string
  durationId: string
  durationSeconds: number
  creditsCost: number
  status: 'queued' | 'processing' | 'succeeded' | 'failed'
  errorCode: string | null
  refunded: boolean
  createdAt: string
  completedAt: string | null
  videoUrl: string | null
  expired: boolean
  removed: boolean
  expiresAt: string | null
}

export type Order = {
  id: string
  provider: string
  packageId: string
  credits: number
  amountCents: number
  currency: string
  status: 'pending' | 'paid' | 'failed' | 'refunded' | 'canceled'
  refundedAmountCents: number // >0 且 status=paid 表示部分退款
  refundedCredits: number
  createdAt: string
  paidAt: string | null
  refundedAt: string | null
}

export type LedgerEntry = {
  id: string
  delta: number
  reason: string
  ref_id: string | null
  note: string | null
  created_at: string
}

export function isActiveGeneration(g: Generation) {
  return g.status === 'queued' || g.status === 'processing'
}
