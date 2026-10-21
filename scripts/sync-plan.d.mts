// scripts/sync-plan.mjs 的类型声明，供 tests/unit/sync-plan.test.ts 引用
export type Layer = 'shared' | 'site' | 'removed' | 'lockfile'
export type FileChange = { status: string; path: string; layer: Layer }
export type SyncPlan = {
  base: string
  target: string
  upToDate: boolean
  commits: string[]
  templateChanges: FileChange[]
  bothChanged: string[]
  divergent: string[]
  migrations: string[]
  newVars: string[]
  newSecrets: string[]
}

export const LAYERS: Record<Layer, string>
export function layerOf(path: string): Layer
export function parseNameStatus(output: string): FileChange[]
export function varsKeys(wranglerText: string): string[]
export function devVarsKeys(text: string): string[]
export function buildPlan(git: (args: string[]) => string | null, target?: string): SyncPlan
