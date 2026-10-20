// Waffo Pancake（Merchant of Record）。只用 WebCrypto，不依赖 Node SDK，可直接跑在 Workers。
// 签名协议参考 @waffo/pancake-ts：RSA-SHA256 over `POST\n{path}\n{timestampSec}\n{base64(sha256(body))}`
import { ApiError, base64Decode, base64Encode, cleanSecret, parseJsonRecord, sha256Hex } from '../util'
import { displayToMinor, minorToDisplay } from './amount'
import type { CheckoutInput, CheckoutResult, PaymentEvent, PaymentProvider, RefundRequest, RefundRequestResult } from './types'
import { WebhookVerificationError } from './types'

const BASE_URL = 'https://api.waffo.ai'
const TOKEN_PATH = '/v1/actions/auth/issue-session-token'
const SESSION_PATH = '/v1/actions/checkout/create-session'
const REFUND_PATH = '/v1/actions/refund-ticket/create-ticket'

export function createWaffoProvider(env: Env): PaymentProvider {
  const merchantId = cleanSecret(env.WAFFO_MERCHANT_ID)
  const privateKey = cleanSecret(env.WAFFO_PRIVATE_KEY)
  const products = parseJsonRecord(env.WAFFO_PRODUCTS)
  return {
    id: 'waffo',
    async createCheckout(input: CheckoutInput): Promise<CheckoutResult> {
      if (!merchantId || !privateKey) throw new ApiError(503, 'payment_not_configured', 'Waffo credentials missing')
      const productId = products[input.order.packageId]
      if (!productId) throw new ApiError(503, 'payment_not_configured', `No Waffo product for ${input.order.packageId}`)
      const key = importSigningKey(privateKey)
      const [token, session] = await Promise.all([
        signedPost<{ token: string }>(merchantId, key, TOKEN_PATH, { productId, buyerIdentity: input.user.id }),
        signedPost<{ sessionId: string; checkoutUrl: string }>(merchantId, key, SESSION_PATH, {
          productId,
          currency: input.order.currency,
          buyerEmail: input.user.email,
          successUrl: input.successUrl,
          expiresInSeconds: 30 * 60,
          orderMerchantExternalId: input.order.id,
          metadata: { orderId: input.order.id, userId: input.user.id, packageId: input.order.packageId },
        }),
      ])
      if (!token.token || !session.checkoutUrl) throw new ApiError(502, 'payment_provider_error', 'Invalid Waffo response')
      return { url: `${session.checkoutUrl}#token=${token.token}`, sessionId: session.sessionId ?? null }
    },
    // Waffo 规则：支付成功 14 天内、每笔支付只能有一次退款（可部分），API 提交的退款自动审批
    // https://docs.waffo.ai/api-reference/endpoints/refunds/create-refund-ticket
    async refund(input: RefundRequest): Promise<RefundRequestResult> {
      if (!merchantId || !privateKey) throw new ApiError(503, 'payment_not_configured', 'Waffo credentials missing')
      const { ticket } = await signedPost<{ ticket?: { id?: string; status?: string } }>(merchantId, importSigningKey(privateKey), REFUND_PATH, {
        paymentId: input.providerPaymentId,
        reason: input.reason,
        requestedAmount: { amount: minorToDisplay(input.amountCents, input.currency), currency: input.currency },
        // 同一订单同一金额的重复提交在 60 秒幂等窗口内命中同一个请求
        refundTicketMerchantExternalId: `${input.orderId}:${input.amountCents}`,
      })
      return { refundId: null, ticketId: ticket?.id ?? null, status: ticket?.status ?? 'processing' }
    },
  }
}

async function signedPost<T>(merchantId: string, key: Promise<CryptoKey>, path: string, body: unknown): Promise<T> {
  const bodyText = JSON.stringify(body)
  const timestamp = String(Math.floor(Date.now() / 1000))
  const bodyHash = base64Encode(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(bodyText)))
  const signature = base64Encode(
    await crypto.subtle.sign(
      { name: 'RSASSA-PKCS1-v1_5' },
      await key,
      new TextEncoder().encode(`POST\n${path}\n${timestamp}\n${bodyHash}`),
    ),
  )
  const response = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Merchant-Id': merchantId,
      'X-Timestamp': timestamp,
      'X-Signature': signature,
      // 60 秒窗口：同一请求的网络重试命中幂等，过期后重新下单能拿到新 token
      'X-Idempotency-Key': await sha256Hex(`${merchantId}:${path}:${bodyText}:${Math.floor(Number(timestamp) / 60)}`),
    },
    body: bodyText,
  })
  let envelope: { data?: unknown; errors?: Array<{ message?: string }> }
  try {
    envelope = (await response.json()) as typeof envelope
  } catch {
    throw new ApiError(502, 'payment_provider_error', `Waffo ${path} returned non-JSON (${response.status})`)
  }
  if (!response.ok || envelope.errors?.length || !envelope.data || typeof envelope.data !== 'object') {
    const message = envelope.errors?.[0]?.message ?? `HTTP ${response.status}`
    // 409 是业务冲突（如该支付已有退款单在处理），原样透传，便于后台看懂
    if (response.status === 409) throw new ApiError(409, 'payment_provider_conflict', `Waffo ${path}: ${message}`)
    throw new ApiError(502, 'payment_provider_error', `Waffo ${path}: ${message}`)
  }
  return envelope.data as T
}

function importSigningKey(raw: string) {
  const normalized = raw.replace(/\\n/g, '\n').replace(/\r\n/g, '\n').trim()
  const isPkcs1 = normalized.includes('BEGIN RSA PRIVATE KEY')
  const der = base64Decode(normalized.replace(/-----(BEGIN|END) (RSA )?PRIVATE KEY-----/g, '').replace(/\s+/g, ''))
  return crypto.subtle.importKey(
    'pkcs8',
    (isPkcs1 ? pkcs1ToPkcs8(der) : der).buffer as ArrayBuffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  )
}

function derLength(length: number) {
  if (length < 128) return [length]
  const bytes: number[] = []
  for (let rest = length; rest > 0; rest = Math.floor(rest / 256)) bytes.unshift(rest & 0xff)
  return [0x80 | bytes.length, ...bytes]
}

function der(tag: number, content: Uint8Array) {
  return Uint8Array.from([tag, ...derLength(content.length), ...content])
}

function concat(...parts: Uint8Array[]) {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

function pkcs1ToPkcs8(pkcs1: Uint8Array) {
  const rsaOid = Uint8Array.of(0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01)
  const algorithm = der(0x30, concat(der(0x06, rsaOid), der(0x05, new Uint8Array())))
  return der(0x30, concat(der(0x02, Uint8Array.of(0)), algorithm, der(0x04, pkcs1)))
}

// ---------- Webhook ----------
// Waffo 用平台公钥签名（test / prod 两把），商户侧无需配置 webhook secret。

const TEST_PUBLIC_KEY = `MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAxnmRY6yMMA3lVqmAU6ZG
b1sjL/+r/z6E+ZjkXaDAKiqOhk9rpazni0bNsGXwmftTPk9jy2wn+j6JHODD/WH/
SCnSfvKkLIjy4Hk7BuCgB174C0ydan7J+KgXLkOwgCAxxB68t2tezldwo74ZpXgn
F49opzMvQ9prEwIAWOE+kV9iK6gx/AckSMtHIHpUesoPDkldpmFHlB2qpf1vsFTZ
5kD6DmGl+2GIVK01aChy2lk8pLv0yUMu18v44sLkO5M44TkGPJD9qG09wrvVG2wp
OTVCn1n5pP8P+HRLcgzbUB3OlZVfdFurn6EZwtyL4ZD9kdkQ4EZE/9inKcp3c1h4
xwIDAQAB`

const PROD_PUBLIC_KEY = `MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAz+xApdTIb4ua+DgZKQ54
iBsD82ybyhGCLRETONW4Jgbb3A8DUM1LqBk6r/CmTOCHqLalTQHNigvP3R5zkDNX
iRJz6gA4MJ/+8K0+mnEE2RISQzN+Qu65TNd6svb+INm/kMaftY4uIXr6y6kchtTJ
dwnQhcKdAL2v7h7IFnkVelQsKxDdb2PqX8xX/qwd01iXvMcpCCaXovUwZsxH2QN5
ZKBTseJivbhUeyJCco4fdUyxOMHe2ybCVhyvim2uxAl1nkvL5L8RCWMCAV55LLo0
9OhmLahz/DYNu13YLVP6dvIT09ZFBYU6Owj1NxdinTynlJCFS9VYwBgmftosSE1U
dwIDAQAB`

const TOLERANCE_MS = 45 * 60 * 1000
const FUTURE_TOLERANCE_MS = 60 * 1000

export type WaffoEnvironment = 'test' | 'prod'

export interface WaffoVerifyOptions {
  nowMs?: number
  publicKey?: CryptoKey // 测试用：注入自签公钥
}

export async function verifyWaffoWebhook(
  rawBody: string,
  signatureHeader: string | null | undefined,
  environment: WaffoEnvironment,
  options: WaffoVerifyOptions = {},
): Promise<Record<string, unknown>> {
  if (!signatureHeader) throw new WebhookVerificationError('missing X-Waffo-Signature')
  let timestamp = ''
  let value = ''
  for (const pair of signatureHeader.split(',')) {
    const index = pair.indexOf('=')
    if (index === -1) continue
    const key = pair.slice(0, index).trim()
    if (key === 't') timestamp = pair.slice(index + 1).trim()
    if (key === 'v1') value = pair.slice(index + 1).trim()
  }
  if (!timestamp || !value) throw new WebhookVerificationError('malformed X-Waffo-Signature')
  const age = (options.nowMs ?? Date.now()) - Number(timestamp)
  if (!Number.isFinite(age) || age > TOLERANCE_MS || age < -FUTURE_TOLERANCE_MS) {
    throw new WebhookVerificationError('timestamp outside tolerance')
  }
  const publicKey = options.publicKey ?? (await importPublicKey(environment))
  let signature: Uint8Array<ArrayBuffer>
  try {
    signature = base64Decode(value)
  } catch {
    throw new WebhookVerificationError('invalid signature encoding')
  }
  const valid = await crypto.subtle.verify(
    { name: 'RSASSA-PKCS1-v1_5' },
    publicKey,
    signature,
    new TextEncoder().encode(`${timestamp}.${rawBody}`),
  )
  if (!valid) throw new WebhookVerificationError('invalid signature')
  const payload = JSON.parse(rawBody) as Record<string, unknown>
  if (payload.mode && payload.mode !== environment) throw new WebhookVerificationError('mode mismatch')
  return payload
}

const publicKeys = new Map<WaffoEnvironment, Promise<CryptoKey>>()
function importPublicKey(environment: WaffoEnvironment) {
  let key = publicKeys.get(environment)
  if (!key) {
    const pem = environment === 'test' ? TEST_PUBLIC_KEY : PROD_PUBLIC_KEY
    key = crypto.subtle.importKey(
      'spki',
      base64Decode(pem.replace(/\s+/g, '')).buffer as ArrayBuffer,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    )
    publicKeys.set(environment, key)
  }
  return key
}

export function waffoEnvironment(env: Env): WaffoEnvironment {
  return env.WAFFO_ENVIRONMENT === 'prod' || env.WAFFO_ENVIRONMENT === 'production' ? 'prod' : 'test'
}

export function normalizeWaffoEvent(payload: Record<string, unknown>): PaymentEvent {
  const eventType = String(payload.eventType ?? '')
  const eventId = String(payload.eventId ?? payload.id ?? '')
  if (!eventId) throw new WebhookVerificationError('missing eventId')
  const data = (payload.data ?? {}) as Record<string, unknown>
  const metadata = (data.orderMetadata ?? data.metadata ?? {}) as Record<string, unknown>
  const orderId = str(data.orderMerchantExternalId) ?? str(metadata.orderId)
  const currency = str(data.currency)
  // 金额是展示格式字符串（"29.00"、JPY "4500"）。amount/total 等字段已弃用（不早于 2027-09-20 移除），
  // 优先读 chargedAmount（实收）/ refundedAmount / originalChargedAmount，旧字段只作回退
  switch (eventType) {
    case 'order.completed': {
      const charged = data.chargedAmount ?? record(data.listPrice).total ?? data.total ?? data.amount
      return {
        kind: 'paid',
        eventId,
        eventType,
        orderId,
        providerOrderId: str(data.orderId),
        providerPaymentId: str(data.paymentId),
        paidAmount: str(charged),
        paidCurrency: currency,
        paidAmountCents: displayToMinor(charged, currency),
      }
    }
    case 'refund.succeeded':
      return {
        kind: 'refunded',
        eventId,
        eventType,
        orderId,
        providerPaymentId: str(data.paymentId),
        refundId: str(data.refundId) ?? eventId,
        refundAmountCents: displayToMinor(data.refundedAmount ?? data.amount, currency),
        originalAmountCents: displayToMinor(data.originalChargedAmount ?? record(data.originalPayment).total, currency),
      }
    default:
      return { kind: 'ignored', eventId, eventType }
  }
}

function str(value: unknown) {
  return typeof value === 'string' && value ? value : typeof value === 'number' ? String(value) : null
}

function record(value: unknown) {
  return (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
}
