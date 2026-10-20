#!/usr/bin/env node
// 上线或更新文案后通知 Bing / Yandex 等支持 IndexNow 的搜索引擎重新抓取（Google 不支持 IndexNow，用 Search Console 提交 sitemap）。
// 前置：site.domain 为正式域名，site.seo.indexNowKey 填 8–128 位字母数字/短横线，并已部署（站点会在 /<key>.txt 返回 key）。
// 用法：
//   npm run seo:indexnow              # 只打印将要提交的 URL，不发请求
//   npm run seo:indexnow -- --submit  # 真正提交
// URL 列表取自正式站的 /sitemap.xml。
import { site } from '../src/config/site.ts'

const submit = process.argv.includes('--submit')
const key = site.seo.indexNowKey
const origin = `https://${site.domain}`

if (!site.domain || site.domain === 'example.com') throw new Error('site.domain 仍是占位域名，先改成正式域名')
if (!/^[A-Za-z0-9-]{8,128}$/.test(key)) throw new Error('site.seo.indexNowKey 需为 8–128 位字母、数字或短横线')

const sitemap = await fetch(`${origin}/sitemap.xml`)
if (!sitemap.ok) throw new Error(`读取 ${origin}/sitemap.xml 失败：HTTP ${sitemap.status}`)
const urls = [...(await sitemap.text()).matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].replace(/&amp;/g, '&'))
console.log(`${urls.length} URLs from ${origin}/sitemap.xml`)
for (const url of urls) console.log(`  ${url}`)

if (!submit) {
  console.log('\n未提交（加 --submit 才会发送）')
  process.exit(0)
}

const keyFile = await fetch(`${origin}/${key}.txt`)
if (!keyFile.ok || (await keyFile.text()).trim() !== key) throw new Error(`${origin}/${key}.txt 不可访问或内容不符，先部署再提交`)

const response = await fetch('https://api.indexnow.org/indexnow', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json; charset=utf-8' },
  body: JSON.stringify({ host: site.domain, key, keyLocation: `${origin}/${key}.txt`, urlList: urls }),
})
// 200/202 都表示已接收；422 通常是 URL 不属于该 host 或 key 不匹配
console.log(`IndexNow → HTTP ${response.status} ${await response.text()}`)
process.exit(response.status === 200 || response.status === 202 ? 0 : 1)
