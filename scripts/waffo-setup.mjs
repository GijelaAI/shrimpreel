// 按 src/config/site.ts 的积分包在 Waffo 建一次性商品、按在售的订阅套餐（sellingPlans，订阅开关打开时的 site.plans）建订阅商品，可选给店铺加 webhook。
// 凭据从 .dev.vars（或同名环境变量）读取：WAFFO_MERCHANT_ID、WAFFO_PRIVATE_KEY；密钥属于 test 还是 prod 由创建时决定。
//
//   node scripts/waffo-setup.mjs --store STO_xxx                      # 只打印计划
//   node scripts/waffo-setup.mjs --store STO_xxx --apply              # 建商品，打印 WAFFO_PRODUCTS
//   node scripts/waffo-setup.mjs --store STO_xxx --apply --write-dev-vars --webhook https://<host>/api/webhooks/waffo
//   node scripts/waffo-setup.mjs --store STO_xxx --apply --webhook https://<new-host>/api/webhooks/waffo --webhook-id <uuid>  # 隧道换域名后改 URL
//
// 已在 WAFFO_PRODUCTS 里有 id 的积分包和订阅套餐会跳过，重复运行不会重复建商品。
// 开了订阅时 WAFFO_STORE_ID 也要配成 --store 的值（账单页“管理付款”的客户门户要用）。
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { createHash, createPrivateKey, randomUUID, sign } from 'node:crypto'
import { sellingPlans, site } from '../src/config/site.ts'

const BASE_URL = 'https://api.waffo.ai'
// 与 normalizeWaffoEvent 处理的事件一致；开了订阅时加上订阅事件 https://docs.waffo.ai/api-reference/webhooks
const SUBSCRIPTION_EVENTS = [
  'subscription.activated',
  'subscription.payment_succeeded',
  'subscription.renewed',
  'subscription.recovered',
  'subscription.canceling',
  'subscription.uncanceled',
  'subscription.canceled',
  'subscription.past_due',
]
const WEBHOOK_EVENTS = ['order.completed', 'refund.succeeded', 'refund.failed', ...(site.plans.length ? SUBSCRIPTION_EVENTS : [])]

const args = parseArgs(process.argv.slice(2))
const devVarsPath = new URL('../.dev.vars', import.meta.url)
const vars = { ...readDevVars(devVarsPath), ...pickEnv(['WAFFO_MERCHANT_ID', 'WAFFO_PRIVATE_KEY', 'WAFFO_PRODUCTS', 'WAFFO_ENVIRONMENT']) }
const storeId = args.store
if (!storeId?.startsWith('STO_')) fail('需要 --store STO_xxx')
const environment = args.prod ? 'prod' : (vars.WAFFO_ENVIRONMENT ?? 'test')
const existing = safeJson(vars.WAFFO_PRODUCTS) ?? {}

const plan = site.packages.map((pkg) => ({
  packageId: pkg.id,
  skip: Boolean(existing[pkg.id]),
  body: {
    storeId,
    name: `${site.brandName} · ${pkg.credits} credits`.slice(0, 64),
    description: `${pkg.credits} credits for ${site.brandName}. One-time purchase, credits never expire.`,
    prices: { [pkg.currency]: { amount: (pkg.priceCents / 100).toFixed(2), taxIncluded: false, taxCategory: 'saas' } },
    metadata: { packageId: pkg.id, credits: String(pkg.credits), site: site.domain },
  },
}))
// 订阅商品不设试用价 https://docs.waffo.ai/api-reference/endpoints/subscription-products/create-product
for (const sub of sellingPlans) {
  plan.push({
    packageId: sub.id,
    skip: Boolean(existing[sub.id]),
    path: '/v1/actions/subscription-product/create-product',
    body: {
      storeId,
      name: `${site.brandName} · ${sub.interval === 'year' ? 'Yearly' : 'Monthly'} (${sub.credits} credits / month)`.slice(0, 64),
      description: `${sub.credits} credits every month for ${site.brandName}. Renews every ${sub.interval} until canceled; monthly credits expire at the end of each month.`,
      billingPeriod: sub.interval === 'year' ? 'yearly' : 'monthly',
      prices: { [sub.currency]: { amount: (sub.priceCents / 100).toFixed(2), taxIncluded: false, taxCategory: 'saas' } },
      metadata: { packageId: sub.id, credits: String(sub.credits), interval: sub.interval, site: site.domain },
    },
  })
}

console.log(`store=${storeId} environment=${environment} apply=${Boolean(args.apply)}`)
for (const item of plan) {
  const price = `${Object.entries(item.body.prices).map(([c, p]) => `${p.amount} ${c}`).join(', ')}${item.body.billingPeriod ? ` / ${item.body.billingPeriod}` : ''}`
  console.log(`  ${item.skip ? 'skip  ' : 'create'} ${item.packageId.padEnd(10)} ${item.body.name} (${price})${item.skip ? ` → ${existing[item.packageId]}` : ''}`)
}
if (args.webhook) console.log(`  webhook ${args['webhook-id'] ? `update ${args['webhook-id']} →` : 'add'} ${args.webhook} events=${WEBHOOK_EVENTS.join(',')} testMode=${environment !== 'prod'}`)
if (!args.apply) {
  console.log('dry run：加 --apply 执行')
  process.exit(0)
}

const merchantId = vars.WAFFO_MERCHANT_ID?.trim()
const privateKey = loadPrivateKey(vars.WAFFO_PRIVATE_KEY)
if (!merchantId) fail('缺少 WAFFO_MERCHANT_ID')

const products = { ...existing }
for (const item of plan) {
  if (item.skip) continue
  const data = await signedPost(item.path ?? '/v1/actions/onetime-product/create-product', item.body)
  products[item.packageId] = data.product.id
  console.log(`created ${item.packageId} → ${data.product.id} (${data.product.status})`)
}
const productsJson = JSON.stringify(products)
console.log(`WAFFO_PRODUCTS=${productsJson}`)

if (args.webhook && args['webhook-id']) {
  const data = await signedPost('/v1/actions/store/update-webhook', { id: args['webhook-id'], url: args.webhook, events: WEBHOOK_EVENTS })
  console.log(`webhook updated: ${JSON.stringify(redact(data))}`)
} else if (args.webhook) {
  const data = await signedPost('/v1/actions/store/add-webhook', {
    storeId,
    channel: 'http',
    url: args.webhook,
    events: WEBHOOK_EVENTS,
    testMode: environment !== 'prod',
  })
  console.log(`webhook added: ${JSON.stringify(redact(data))}`)
}

if (args['write-dev-vars']) {
  if (!existsSync(devVarsPath)) fail('.dev.vars 不存在')
  let text = readFileSync(devVarsPath, 'utf8')
  text = setVar(text, 'WAFFO_PRODUCTS', `'${productsJson}'`)
  if (sellingPlans.length) text = setVar(text, 'WAFFO_STORE_ID', `'${storeId}'`)
  writeFileSync(devVarsPath, text)
  console.log(`已写入 .dev.vars 的 WAFFO_PRODUCTS${sellingPlans.length ? '、WAFFO_STORE_ID' : ''}`)
}

// ---------- helpers ----------

async function signedPost(path, body) {
  const bodyText = JSON.stringify(body)
  const timestamp = String(Math.floor(Date.now() / 1000))
  const bodyHash = createHash('sha256').update(bodyText).digest('base64')
  const signature = sign('sha256', Buffer.from(`POST\n${path}\n${timestamp}\n${bodyHash}`), privateKey).toString('base64')
  const response = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Merchant-Id': merchantId,
      'X-Timestamp': timestamp,
      'X-Signature': signature,
      'X-Idempotency-Key': randomUUID(),
    },
    body: bodyText,
  })
  const envelope = await response.json().catch(() => ({}))
  if (!response.ok || envelope.errors?.length || !envelope.data) {
    fail(`${path} → HTTP ${response.status} ${JSON.stringify(envelope.errors ?? envelope).slice(0, 500)}`)
  }
  return envelope.data
}

function loadPrivateKey(raw) {
  if (!raw) fail('缺少 WAFFO_PRIVATE_KEY')
  const normalized = raw.replace(/\\n/g, '\n').trim()
  if (normalized.includes('-----BEGIN')) return createPrivateKey(normalized)
  return createPrivateKey({ key: Buffer.from(normalized.replace(/\s+/g, ''), 'base64'), format: 'der', type: 'pkcs8' })
}

function readDevVars(path) {
  if (!existsSync(path)) return {}
  const out = {}
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (!match) continue
    let value = match[2]
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1)
    if (value) out[match[1]] = value
  }
  return out
}

function setVar(text, name, value) {
  const re = new RegExp(`^${name}=.*$`, 'm')
  return re.test(text) ? text.replace(re, () => `${name}=${value}`) : `${text.trimEnd()}\n${name}=${value}\n`
}

function pickEnv(names) {
  return Object.fromEntries(names.filter((n) => process.env[n]).map((n) => [n, process.env[n]]))
}

function parseArgs(list) {
  const out = {}
  for (let i = 0; i < list.length; i++) {
    const key = list[i].replace(/^--/, '')
    const next = list[i + 1]
    if (next && !next.startsWith('--')) {
      out[key] = next
      i++
    } else out[key] = true
  }
  return out
}

function safeJson(text) {
  try {
    return text ? JSON.parse(text) : null
  } catch {
    return null
  }
}

function redact(value) {
  return JSON.parse(JSON.stringify(value, (k, v) => (/secret|token|key/i.test(k) ? '[redacted]' : v)))
}

function fail(message) {
  console.error(message)
  process.exit(1)
}
