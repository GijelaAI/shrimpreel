import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// tests/e2e/CATALOG.md 按风险索引用例，标题写错或新增用例没登记都会让目录失真
const catalog = readFileSync('tests/e2e/CATALOG.md', 'utf8')

// 只取单引号的静态标题；模板字符串标题（如 smoke 里按语言展开的用例）不在目录里逐条引用
function titles(dir: string) {
  const out = new Map<string, Set<string>>()
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.spec.ts'))) {
    const source = readFileSync(`${dir}/${file}`, 'utf8')
    out.set(file, new Set([...source.matchAll(/^\s*test\('([^']+)'/gm)].map((m) => m[1]!)))
  }
  return out
}

describe('e2e 验收目录', () => {
  const e2e = titles('tests/e2e')
  const smoke = titles('tests/smoke')
  const sandbox = titles('tests/sandbox')
  const refs = [...catalog.matchAll(/`([\w.-]+\.spec\.ts)` › `([^`]+)`/g)].map((m) => ({ file: m[1]!, title: m[2]! }))

  it('引用的用例都存在', () => {
    expect(refs.length).toBeGreaterThan(0)
    const missing = refs.filter(({ file, title }) => !(e2e.get(file) ?? smoke.get(file) ?? sandbox.get(file))?.has(title))
    expect(missing).toEqual([])
  })

  it('tests/e2e 和 tests/sandbox 的每个用例都登记在目录里', () => {
    const listed = new Set(refs.map(({ file, title }) => `${file} › ${title}`))
    const unlisted = [...e2e, ...sandbox].flatMap(([file, set]) => [...set].map((title) => `${file} › ${title}`)).filter((key) => !listed.has(key))
    expect(unlisted).toEqual([])
  })

  it('提到的单元测试文件都存在', () => {
    const files = [...new Set([...catalog.matchAll(/`([\w-]+\.test\.ts)`/g)].map((m) => m[1]!))]
    expect(files.filter((f) => !existsSync(`tests/unit/${f}`))).toEqual([])
  })
})
