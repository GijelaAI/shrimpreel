#!/usr/bin/env node
// 把 D1 每日备份（src/server/backup.ts 写到 R2 的 backups/d1/<日期>.sql.gz）恢复到一个空的 D1 数据库。
// 默认只出计划：解压到 .tmp/restore-d1/、统计表数和行数、检查目标库是否为空；加 --apply 才导入。
// 目标库必须是空的（新建后不要跑迁移）：备份里自带建表语句和 d1_migrations 记录，导入后迁移状态和备份时一致。
// 备份不含登录会话，恢复后所有人需要重新登录。
//
//   node scripts/restore-d1.mjs --date 2026-10-21 --remote --database <新库名>        # 从线上 R2 下载当天备份，检查目标库
//   node scripts/restore-d1.mjs --date 2026-10-21 --remote --database <新库名> --apply
//   node scripts/restore-d1.mjs --file backup.sql.gz --local --persist-to .tmp/restore-d1/state --apply
//   -c wrangler.staging.jsonc  用预发配置（bucket 名和默认数据库名从这里读）
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gunzipSync } from 'node:zlib'
import { readWranglerConfig } from './doctor.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const WRANGLER_BIN = fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url))
const WORK_DIR = join(ROOT, '.tmp', 'restore-d1')

function parseArgs(argv) {
  const args = { config: 'wrangler.jsonc', apply: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const value = () => {
      const next = argv[++i]
      if (!next || next.startsWith('--')) throw new Error(`${arg} 需要一个值`)
      return next
    }
    if (arg === '--apply') args.apply = true
    else if (arg === '--local' || arg === '--remote') {
      if (args.target && args.target !== arg.slice(2)) throw new Error('--local 和 --remote 只能选一个')
      args.target = arg.slice(2)
    } else if (arg === '--date') args.date = value()
    else if (arg === '--file') args.file = value()
    else if (arg === '--database') args.database = value()
    else if (arg === '--persist-to') args.persistTo = value()
    else if (arg === '-c' || arg === '--config') args.config = value()
    else throw new Error(`未知参数 ${arg}`)
  }
  if (!args.target) throw new Error('要指定 --local 或 --remote')
  if (!args.date === !args.file) throw new Error('--date 和 --file 二选一')
  if (args.date && !/^\d{4}-\d{2}-\d{2}$/.test(args.date)) throw new Error('--date 格式是 YYYY-MM-DD')
  if (args.persistTo && args.target !== 'local') throw new Error('--persist-to 只能和 --local 一起用')
  return args
}

function wrangler(args) {
  const result = spawnSync(process.execPath, [WRANGLER_BIN, ...args], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  return { ok: result.status === 0, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
}

// 备份文件里的统计：建表数、每张表的 INSERT 行数
export function summarizeDump(sql) {
  const tables = [...sql.matchAll(/^CREATE TABLE (?:IF NOT EXISTS )?"?([^\s"(]+)"?/gm)].map((m) => m[1])
  const rows = {}
  for (const match of sql.matchAll(/^INSERT INTO "((?:[^"]|"")+)"/gm)) {
    const name = match[1].replace(/""/g, '"')
    rows[name] = (rows[name] ?? 0) + 1
  }
  return { tables, rows, header: sql.split('\n', 1)[0] }
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const config = readWranglerConfig(join(ROOT, args.config))
  const database = args.database ?? config.d1_databases?.[0]?.database_name
  if (!database) throw new Error(`${args.config} 里没有 d1_databases`)
  mkdirSync(WORK_DIR, { recursive: true })

  let gzPath = args.file
  if (args.date) {
    const bucket = config.r2_buckets?.find((b) => b.binding === 'MEDIA')?.bucket_name
    if (!bucket) throw new Error(`${args.config} 里没有 MEDIA bucket`)
    gzPath = join(WORK_DIR, `${args.date}.sql.gz`)
    const key = `${bucket}/backups/d1/${args.date}.sql.gz`
    console.log(`下载 ${key}（${args.target}）`)
    const got = wrangler(['r2', 'object', 'get', key, '--file', gzPath, `--${args.target}`, '-c', args.config, ...(args.persistTo ? ['--persist-to', args.persistTo] : [])])
    if (!got.ok) throw new Error(`下载失败：${got.stderr.trim().split('\n').slice(-3).join(' ')}`)
  }

  const sql = gunzipSync(readFileSync(gzPath)).toString('utf8')
  if (!sql.startsWith('-- D1 backup ')) throw new Error(`${gzPath} 不是本项目的 D1 备份`)
  const sqlPath = join(WORK_DIR, basename(gzPath).replace(/\.gz$/, ''))
  writeFileSync(sqlPath, sql)
  const summary = summarizeDump(sql)
  const total = Object.values(summary.rows).reduce((sum, n) => sum + n, 0)
  console.log(`${summary.header.slice(3)}：${summary.tables.length} 张表，${total} 行 → ${sqlPath}`)
  for (const table of summary.tables) console.log(`  ${table.padEnd(24)} ${summary.rows[table] ?? 0}`)

  const location = [`--${args.target}`, '-c', args.config, ...(args.persistTo ? ['--persist-to', args.persistTo] : [])]
  const existing = wrangler([
    'd1', 'execute', database, ...location, '--json',
    '--command', "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'",
  ])
  if (!existing.ok) throw new Error(`读取目标库 ${database} 失败：${existing.stderr.trim().split('\n').slice(-3).join(' ')}`)
  const names = JSON.parse(existing.stdout).flatMap((r) => r.results ?? []).map((r) => r.name)
  if (names.length) throw new Error(`目标库 ${database}（${args.target}）不是空的，已有 ${names.length} 张表（${names.slice(0, 5).join('、')}…）。新建一个数据库再恢复`)
  console.log(`目标库 ${database}（${args.target}）是空的`)

  if (!args.apply) {
    console.log('只出计划。确认无误后加 --apply 导入')
    return
  }
  const run = wrangler(['d1', 'execute', database, ...location, '--file', sqlPath, '--yes'])
  if (!run.ok) throw new Error(`导入失败：${run.stderr.trim().split('\n').slice(-5).join(' ')}`)
  console.log(`已导入 ${database}（${args.target}）。改 wrangler 配置的 database_id 指向它后重新部署`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    main()
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  }
}
