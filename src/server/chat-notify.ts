// 付款即时通知：配置了 PAYMENT_NOTIFY_WEBHOOK_URL（secret）时，每笔订单首次入账发一条消息到聊天群。
// 按域名识别 Telegram、飞书 / Lark、Discord，其他地址（Slack 等）发 {"text": ...}。
// URL 里带 token：日志和报错只写服务商与状态码，不写 URL。

type Kind = 'telegram' | 'feishu' | 'discord' | 'generic'

export interface ChatRequest {
  kind: Kind
  url: string
  body: unknown
}

// 不是 https 或缺参数时返回 null
export function chatRequest(webhookUrl: string, text: string): ChatRequest | null {
  let url: URL
  try {
    url = new URL(webhookUrl.trim())
  } catch {
    return null
  }
  if (url.protocol !== 'https:') return null
  const host = url.hostname.toLowerCase()
  if (host === 'api.telegram.org') {
    // https://api.telegram.org/bot<token>/sendMessage?chat_id=<id>
    const chatId = url.searchParams.get('chat_id')
    if (!chatId) return null
    url.searchParams.delete('chat_id')
    return { kind: 'telegram', url: url.toString(), body: { chat_id: chatId, text, link_preview_options: { is_disabled: true } } }
  }
  if (host === 'open.feishu.cn' || host === 'open.larksuite.com') {
    return { kind: 'feishu', url: url.toString(), body: { msg_type: 'text', content: { text } } }
  }
  if ((host === 'discord.com' || host === 'discordapp.com') && url.pathname.startsWith('/api/webhooks/')) {
    // 不解析 @everyone 之类的提及
    return { kind: 'discord', url: url.toString(), body: { content: text, allowed_mentions: { parse: [] } } }
  }
  return { kind: 'generic', url: url.toString(), body: { text } }
}

export async function postChatMessage(webhookUrl: string, text: string, fetcher: typeof fetch = fetch) {
  const request = chatRequest(webhookUrl, text)
  if (!request) throw new Error('chat webhook: PAYMENT_NOTIFY_WEBHOOK_URL 不是有效的 https 地址（Telegram 要带 chat_id）')
  let response: Response
  try {
    response = await fetcher(request.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request.body),
      signal: AbortSignal.timeout(5000),
    })
  } catch (error) {
    // 原始错误可能带 URL
    throw new Error(`chat webhook (${request.kind}) request failed: ${error instanceof Error ? error.name : 'unknown'}`)
  }
  if (!response.ok) throw new Error(`chat webhook (${request.kind}) HTTP ${response.status}`)
  // 飞书在关键词、签名校验不通过时也返回 200，错误码在 body 的 code 里
  if (request.kind === 'feishu') {
    const data = await response.json<{ code?: number }>().catch(() => null)
    if (data?.code) throw new Error(`chat webhook (feishu) code ${data.code}`)
  }
}
