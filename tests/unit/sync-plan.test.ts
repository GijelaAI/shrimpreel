import { describe, expect, it } from 'vitest'
import { buildPlan, layerOf } from '../../scripts/sync-plan.mjs'

describe('sync-plan', () => {
  it('按 AGENTS.md 的站点差异文件分层，public/_headers 仍是共用代码', () => {
    const layers = Object.fromEntries(
      ['src/config/site.ts', 'src/content/zh.ts', 'public/og.png', 'public/_headers', 'seed/templates/a-6s.mp4', 'wrangler.jsonc', 'package.json', 'package-lock.json', 'wrangler.staging.jsonc', 'src/server/orders.ts', 'src/styles.css', 'migrations/0009_x.sql'].map((p) => [p, layerOf(p)]),
    )
    expect(layers).toEqual({
      'src/config/site.ts': 'site',
      'src/content/zh.ts': 'site',
      'public/og.png': 'site',
      'public/_headers': 'shared',
      'seed/templates/a-6s.mp4': 'site',
      'wrangler.jsonc': 'site',
      'package.json': 'site',
      'package-lock.json': 'lockfile',
      'wrangler.staging.jsonc': 'removed',
      'src/server/orders.ts': 'shared',
      'src/styles.css': 'shared',
      'migrations/0009_x.sql': 'shared',
    })
  })

  it('计划：两边都改的文件、站点改过的共用文件、新增 migration、vars 和密钥；没有共同历史时报错', () => {
    const files: Record<string, string> = {
      'base:wrangler.jsonc': '{ "name": "x", "vars": { "APP_ENV": "development" } }',
      'tip:wrangler.jsonc': '{\n  // 注释\n  "name": "x",\n  "vars": { "APP_ENV": "development", "NEW_FLAG": "off" },\n}',
      'base:.dev.vars.example': 'SESSION_SECRET=x\n',
      'tip:.dev.vars.example': 'SESSION_SECRET=x\nNEW_KEY=replace-me\n# OPTIONAL_KEY=\n',
    }
    const git = (args: string[]): string | null => {
      const [cmd, ...rest] = args
      if (cmd === 'rev-parse') return 'tip'
      if (cmd === 'merge-base') return 'base'
      if (cmd === 'log') return 'tip Template update'
      if (cmd === 'show') return files[rest[0]!] ?? null
      if (cmd === 'diff' && rest.at(-1) === 'tip') return ['M\tsrc/content/en.ts', 'A\tmigrations/0009_x.sql', 'M\tmigrations/0001_init.sql', 'M\tsrc/server/orders.ts', 'M\twrangler.staging.jsonc'].join('\n')
      if (cmd === 'diff' && rest.at(-1) === 'HEAD') return ['M\tsrc/content/en.ts', 'M\tsrc/styles.css', 'D\twrangler.staging.jsonc'].join('\n')
      return null
    }
    const plan = buildPlan(git)
    expect(plan.upToDate).toBe(false)
    expect(plan.bothChanged).toEqual(['src/content/en.ts', 'wrangler.staging.jsonc'])
    expect(plan.divergent).toEqual(['src/styles.css'])
    expect(plan.migrations).toEqual(['migrations/0009_x.sql'])
    expect(plan.newVars).toEqual(['NEW_FLAG'])
    expect(plan.newSecrets).toEqual(['NEW_KEY', 'OPTIONAL_KEY'])

    expect(() => buildPlan((args) => (args[0] === 'merge-base' ? null : git(args)))).toThrow('没有共同历史')
    expect(() => buildPlan(() => null)).toThrow('git fetch upstream')
  })
})
