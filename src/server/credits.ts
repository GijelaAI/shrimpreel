import { createId, nowIso } from './util'

// 所有积分变动都走这里：流水 + 余额在同一个 D1 batch（事务）里。
// - idempotency_key 唯一：重复入账整个 batch 回滚（isUniqueConstraintError）
// - users.credits CHECK (>= 0)：扣到负数整个 batch 回滚（isCheckConstraintError）

export type LedgerReason =
  | 'signup_bonus'
  | 'purchase'
  | 'generation'
  | 'generation_refund'
  | 'order_refund'
  | 'admin_adjust'
  | 'account_deleted'

export interface LedgerEntry {
  userId: string
  delta: number
  reason: LedgerReason
  refId?: string | null
  idempotencyKey: string
  note?: string | null
}

export function ledgerStatements(db: D1Database, entry: LedgerEntry): D1PreparedStatement[] {
  return [
    db
      .prepare(
        `INSERT INTO credit_ledger (id, user_id, delta, reason, ref_id, idempotency_key, note, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        createId('led'),
        entry.userId,
        entry.delta,
        entry.reason,
        entry.refId ?? null,
        entry.idempotencyKey,
        entry.note ?? null,
        nowIso(),
      ),
    db.prepare('UPDATE users SET credits = credits + ? WHERE id = ?').bind(entry.delta, entry.userId),
  ]
}

// 退款回收：最多扣到 0（用户可能已经花掉部分积分），流水记录实际扣除量。
export function clawbackStatements(
  db: D1Database,
  entry: Omit<LedgerEntry, 'delta'> & { maxAmount: number },
): D1PreparedStatement[] {
  return [
    db
      .prepare(
        `INSERT INTO credit_ledger (id, user_id, delta, reason, ref_id, idempotency_key, note, created_at)
         SELECT ?, id, -MIN(credits, ?), ?, ?, ?, ?, ? FROM users WHERE id = ?`,
      )
      .bind(
        createId('led'),
        entry.maxAmount,
        entry.reason,
        entry.refId ?? null,
        entry.idempotencyKey,
        entry.note ?? null,
        nowIso(),
        entry.userId,
      ),
    db.prepare('UPDATE users SET credits = credits - MIN(credits, ?) WHERE id = ?').bind(entry.maxAmount, entry.userId),
  ]
}
