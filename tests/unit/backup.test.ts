import { describe, expect, it } from 'vitest'
import { backupKey, sqlLiteral } from '#/server/backup'

// 导出、导入的完整往返在本地 D1 上验证（见 README“数据备份”），这里只覆盖字面量转义的边界
describe('sqlLiteral', () => {
  it('字符串里的单引号加倍，换行、分号、注释符原样保留在引号内', () => {
    expect(sqlLiteral("it's")).toBe("'it''s'")
    expect(sqlLiteral("a';DROP TABLE users;--\nb")).toBe("'a'';DROP TABLE users;--\nb'")
    expect(sqlLiteral('')).toBe("''")
  })

  it('NULL、数字、非有限数、BLOB', () => {
    expect(sqlLiteral(null)).toBe('NULL')
    expect(sqlLiteral(undefined)).toBe('NULL')
    expect(sqlLiteral(42)).toBe('42')
    expect(sqlLiteral(-1.5)).toBe('-1.5')
    expect(sqlLiteral(Number.NaN)).toBe('NULL')
    expect(sqlLiteral([0, 15, 255])).toBe("X'000fff'")
    expect(sqlLiteral(new Uint8Array([1, 2]).buffer)).toBe("X'0102'")
  })

  it('备份文件按 UTC 日期命名，字符串顺序就是日期顺序', () => {
    expect(backupKey('2026-10-21')).toBe('backups/d1/2026-10-21.sql.gz')
    expect(backupKey('2026-09-30') < backupKey('2026-10-01')).toBe(true)
  })
})
