import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'

// 在本地 SQLite（node:sqlite）上真跑迁移和账务 SQL 的最小 D1 外壳：batch = 一个事务，返回每条语句的 results。
// 只覆盖服务端代码用到的 prepare / bind / first / run / all / batch；D1 线上的事务与约束行为由 e2e（本地 Worker 运行时）覆盖。
const MIGRATIONS = join(import.meta.dirname, '../../migrations')

export class Stmt {
  constructor(
    readonly sql: string,
    readonly args: unknown[] = [],
    private readonly sqlite?: DatabaseSync,
  ) {}
  bind(...args: unknown[]) {
    return new Stmt(this.sql, args, this.sqlite)
  }
  private statement() {
    return this.sqlite!.prepare(this.sql)
  }
  async first(column?: string) {
    const row = (this.statement().get(...(this.args as never[])) ?? null) as Record<string, unknown> | null
    return column === undefined ? row : (row?.[column] ?? null)
  }
  async all() {
    return { results: this.statement().all(...(this.args as never[])) }
  }
  async run() {
    return { meta: { changes: Number(this.statement().run(...(this.args as never[])).changes) } }
  }
}

export function d1Shim(sqlite: DatabaseSync) {
  return {
    prepare: (sql: string) => new Stmt(sql, [], sqlite),
    async batch(statements: Stmt[]) {
      sqlite.exec('BEGIN')
      try {
        // 和 D1 一样每条都带 meta.changes；有返回行的语句（SELECT、RETURNING）照常给 results
        const results = statements.map((s) => {
          const statement = sqlite.prepare(s.sql)
          if (/^\s*(SELECT|WITH)\b|\bRETURNING\b/i.test(s.sql)) return { results: statement.all(...(s.args as never[])), meta: { changes: 0 } }
          return { results: [], meta: { changes: Number(statement.run(...(s.args as never[])).changes) } }
        })
        sqlite.exec('COMMIT')
        return results
      } catch (error) {
        sqlite.exec('ROLLBACK')
        throw error
      }
    },
  }
}

// 按编号依次执行迁移（含两端）
export function migrate(sqlite: DatabaseSync, from = 1, to = Infinity) {
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()) {
    const n = Number(file.slice(0, 4))
    if (n < from || n > to) continue
    sqlite.exec(readFileSync(join(MIGRATIONS, file), 'utf8'))
  }
}

// 进程内的 KV 外壳：只覆盖 get（text / json）、put、delete，不模拟过期和最终一致
export function kvShim() {
  const store = new Map<string, string>()
  return {
    store,
    async get(key: string, options?: 'text' | 'json' | { type?: 'text' | 'json' }) {
      const value = store.get(key) ?? null
      const type = typeof options === 'string' ? options : options?.type
      return value !== null && type === 'json' ? JSON.parse(value) : value
    },
    async put(key: string, value: string) {
      store.set(key, value)
    },
    async delete(key: string) {
      store.delete(key)
    },
  }
}
