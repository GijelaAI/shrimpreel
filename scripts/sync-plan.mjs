#!/usr/bin/env node
// 合并模板更新前的计划（只读 git，不改工作区）：同步基线、模板的新提交、按层归类的改动、两边都改过的文件、
// 站点改过的共用文件、新 migration、新增的 vars 和密钥。合并步骤见 .claude/skills/sync-upstream。
//   git fetch upstream
//   node scripts/sync-plan.mjs                      # 对比 upstream/main
//   node scripts/sync-plan.mjs --target <ref> --json
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

// 站点层：每个站自己的值（与 AGENTS.md“改动前”一致）。public/_headers 是共用的安全响应头，不算站点层
const SITE_FILES = ['src/config/site.ts', 'wrangler.jsonc', 'package.json']
const SITE_DIRS = ['src/content/', 'public/', 'seed/']
const SHARED_IN_SITE_DIRS = ['public/_headers']
// new-site 在站点里删掉的模板自用文件
const SITE_REMOVED = ['wrangler.staging.jsonc']

export const LAYERS = {
  shared: '共用代码：取模板版本；站点改过的先停下确认',
  site: '站点层：保留站点的值，接受模板新增的键和字段',
  removed: '站点已删除：git rm',
  lockfile: '依赖锁：取模板版本后 npm install',
}

export function layerOf(path) {
  if (SITE_REMOVED.includes(path)) return 'removed'
  if (path === 'package-lock.json') return 'lockfile'
  if (SHARED_IN_SITE_DIRS.includes(path)) return 'shared'
  if (SITE_FILES.includes(path) || SITE_DIRS.some((dir) => path.startsWith(dir))) return 'site'
  return 'shared'
}

export function parseNameStatus(output) {
  return output
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [status, path] = line.split('\t')
      return { status: status[0], path, layer: layerOf(path) }
    })
}

export function varsKeys(wranglerText) {
  if (!wranglerText) return []
  const { config, error } = ts.parseConfigFileTextToJson('wrangler.jsonc', wranglerText)
  if (error) throw new Error(`wrangler.jsonc: ${ts.flattenDiagnosticMessageText(error.messageText, '\n')}`)
  return Object.keys(config.vars ?? {})
}

export function devVarsKeys(text) {
  return [...(text ?? '').matchAll(/^\s*#?\s*([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1])
}

const added = (before, after) => after.filter((key) => !before.includes(key))

// git(args) 返回 stdout；失败时返回 null
export function buildPlan(git, target = 'upstream/main') {
  const targetSha = git(['rev-parse', '--verify', `${target}^{commit}`])
  if (!targetSha) throw new Error(`找不到 ${target}：先 git fetch upstream`)
  const base = git(['merge-base', 'HEAD', targetSha])
  if (!base) throw new Error(`当前仓库和 ${target} 没有共同历史（可能是用 GitHub “Use this template” 建的），无法 git merge，见 README“上新词流程”第 1 步`)
  const show = (ref, file) => git(['show', `${ref}:${file}`]) ?? ''
  const templateChanges = parseNameStatus(git(['diff', '--name-status', '--no-renames', base, targetSha]) ?? '')
  const siteChanges = parseNameStatus(git(['diff', '--name-status', '--no-renames', base, 'HEAD']) ?? '')
  const siteChanged = new Set(siteChanges.map((c) => c.path))
  return {
    base,
    target: targetSha,
    upToDate: base === targetSha,
    commits: (git(['log', '--oneline', '--no-merges', `${base}..${targetSha}`]) ?? '').split('\n').filter(Boolean),
    templateChanges,
    bothChanged: templateChanges.filter((c) => siteChanged.has(c.path)).map((c) => c.path),
    // 站点改过的共用文件：合并时会被模板覆盖或冲突，应该先回到模板里修
    divergent: siteChanges.filter((c) => c.layer === 'shared').map((c) => c.path),
    migrations: templateChanges.filter((c) => c.status === 'A' && c.path.startsWith('migrations/')).map((c) => c.path),
    newVars: added(varsKeys(show(base, 'wrangler.jsonc')), varsKeys(show(targetSha, 'wrangler.jsonc'))),
    newSecrets: added(devVarsKeys(show(base, '.dev.vars.example')), devVarsKeys(show(targetSha, '.dev.vars.example'))),
  }
}

function git(args) {
  const result = spawnSync('git', ['-c', 'core.quotepath=off', ...args], { encoding: 'utf8' })
  return result.status === 0 ? result.stdout.trim() : null
}

function main(args) {
  const index = args.indexOf('--target')
  const target = index >= 0 ? args[index + 1] : 'upstream/main'
  let plan
  try {
    plan = buildPlan(git, target)
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
    return
  }
  if (args.includes('--json')) return console.log(JSON.stringify(plan, null, 2))

  const short = (sha) => sha.slice(0, 12)
  console.log(`同步基线 ${short(plan.base)} → ${target} ${short(plan.target)}`)
  if (plan.upToDate) return console.log('已经是最新，不需要合并。')
  console.log(`\n模板新提交（${plan.commits.length}）：`)
  for (const line of plan.commits) console.log(`  ${line}`)
  for (const [layer, label] of Object.entries(LAYERS)) {
    const files = plan.templateChanges.filter((c) => c.layer === layer)
    if (!files.length) continue
    console.log(`\n${label}（${files.length}）：`)
    for (const c of files) console.log(`  ${c.status} ${c.path}${plan.bothChanged.includes(c.path) ? '  ← 站点也改过' : ''}`)
  }
  const section = (title, items) => items.length && console.log(`\n${title}：\n${items.map((i) => `  ${i}`).join('\n')}`)
  section('站点改过的共用文件（合并前先确认，能回到模板修的回模板修）', plan.divergent)
  section('新 migration（部署前 npm run db:migrate:remote）', plan.migrations)
  section('新增 vars（wrangler.jsonc，填站点的值，含义见 docs/env.md）', plan.newVars)
  section('新增密钥（.dev.vars.example，线上用 wrangler secret put）', plan.newSecrets)
  console.log(`\n合并提交信息末尾加一行：Template-sync: ${plan.target}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2))
