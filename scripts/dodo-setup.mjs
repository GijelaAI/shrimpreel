// 按 src/config/site.ts 的积分包在 Dodo 建一次性商品，可选建/改 webhook 并取签名密钥。
// 凭据从 .dev.vars（或同名环境变量）读取：DODO_API_KEY；DODO_ENVIRONMENT=live 时打正式环境，否则 test。
// API 密钥需要权限：产品 写入；用 --webhook 时还要 Webhooks 写入。
//
//   node scripts/dodo-setup.mjs                                         # 只打印计划
//   node scripts/dodo-setup.mjs --apply                                 # 建商品，打印 DODO_PRODUCTS
//   node scripts/dodo-setup.mjs --apply --write-dev-vars --webhook https://<host>/api/webhooks/dodo
//   node scripts/dodo-setup.mjs --apply --write-dev-vars --webhook https://<new-host>/api/webhooks/dodo --webhook-id whk_xxx  # 隧道换域名后改 URL
//
// 已在 DODO_PRODUCTS 里有 id 的积分包会跳过，重复运行不会重复建商品。
// webhook 签名密钥只写进 .dev.vars 的 DODO_WEBHOOK_SECRET（需 --write-dev-vars），不打印；生产用 `wrangler secret put DODO_WEBHOOK_SECRET`。
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { site } from '../src/config/site.ts'

// 与 normalizeDodoEvent 处理的事件一致；refund.failed 只记录不处理，便于排查
const WEBHOOK_EVENTS = ['payment.succeeded', 'payment.failed', 'payment.cancelled', 'refund.succeeded', 'refund.failed']

const args = parseArgs(process.argv.slice(2))
const devVarsPath = new URL('../.dev.vars', import.meta.url)
const vars = { ...readDevVars(devVarsPath), ...pickEnv(['DODO_API_KEY', 'DODO_PRODUCTS', 'DODO_ENVIRONMENT']) }
const environment = args.live ? 'live' : (vars.DODO_ENVIRONMENT ?? 'test')
const baseUrl = environment === 'live' ? 'https://live.dodopayments.com' : 'https://test.dodopayments.com'
const existing = safeJson(vars.DODO_PRODUCTS) ?? {}

const plan = site.packages.map((pkg) => ({
  packageId: pkg.id,
  skip: Boolean(existing[pkg.id]),
  body: {
    name: `${site.brandName} · ${pkg.credits} credits`.slice(0, 64),
    description: `${pkg.credits} credits for ${site.brandName}. One-time purchase, credits never expire.`,
    tax_category: 'saas',
    price: { type: 'one_time_price', currency: pkg.currency, price: pkg.priceCents, discount: 0, purchasing_power_parity: false, tax_inclusive: false },
    metadata: { packageId: pkg.id, credits: String(pkg.credits), site: site.domain },
  },
}))

console.log(`environment=${environment} apply=${Boolean(args.apply)}`)
for (const item of plan) {
  const price = `${(item.body.price.price / 100).toFixed(2)} ${item.body.price.currency}`
  console.log(`  ${item.skip ? 'skip  ' : 'create'} ${item.packageId.padEnd(10)} ${item.body.name} (${price})${item.skip ? ` → ${existing[item.packageId]}` : ''}`)
}
if (args.webhook) console.log(`  webhook ${args['webhook-id'] ? `update ${args['webhook-id']} →` : 'add'} ${args.webhook} events=${WEBHOOK_EVENTS.join(',')}`)
if (!args.apply) {
  console.log('dry run：加 --apply 执行')
  process.exit(0)
}

const apiKey = vars.DODO_API_KEY?.trim()
if (!apiKey) fail('缺少 DODO_API_KEY')

const products = { ...existing }
for (const item of plan) {
  if (item.skip) continue
  const data = await request('POST', '/products', item.body)
  products[item.packageId] = data.product_id
  console.log(`created ${item.packageId} → ${data.product_id}`)
}
const productsJson = JSON.stringify(products)
console.log(`DODO_PRODUCTS=${productsJson}`)

let webhookId = args['webhook-id']
if (args.webhook && webhookId) {
  await request('PATCH', `/webhooks/${webhookId}`, { url: args.webhook, filter_types: WEBHOOK_EVENTS })
  console.log(`webhook updated: ${webhookId} → ${args.webhook}`)
} else if (args.webhook) {
  const data = await request('POST', '/webhooks', { url: args.webhook, filter_types: WEBHOOK_EVENTS, description: `${site.domain} credits` })
  webhookId = data.id
  console.log(`webhook added: ${webhookId} → ${args.webhook}`)
}

if (args['write-dev-vars']) {
  if (!existsSync(devVarsPath)) fail('.dev.vars 不存在')
  let text = readFileSync(devVarsPath, 'utf8')
  text = setVar(text, 'DODO_PRODUCTS', `'${productsJson}'`)
  const written = ['DODO_PRODUCTS']
  if (args.webhook && !args['webhook-id']) {
    const { secret } = await request('GET', `/webhooks/${webhookId}/secret`)
    if (!secret) fail('webhook secret 为空')
    text = setVar(text, 'DODO_WEBHOOK_SECRET', `"${secret}"`)
    written.push('DODO_WEBHOOK_SECRET')
  }
  writeFileSync(devVarsPath, text)
  console.log(`已写入 .dev.vars 的 ${written.join('、')}`)
}

// ---------- helpers ----------

async function request(method, path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await response.text()
  if (!response.ok) fail(`${method} ${path} → HTTP ${response.status} ${text.slice(0, 500)}`)
  return text ? JSON.parse(text) : {}
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

function fail(message) {
  console.error(message)
  process.exit(1)
}
