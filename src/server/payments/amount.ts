// 金额统一成最小货币单位（USD 分、JPY 円），便于汇总和按比例退款。

const exponents = new Map<string, number>()

export function currencyExponent(currency: string) {
  const code = currency.toUpperCase()
  let exponent = exponents.get(code)
  if (exponent === undefined) {
    try {
      exponent = new Intl.NumberFormat('en', { style: 'currency', currency: code }).resolvedOptions().maximumFractionDigits ?? 2
    } catch {
      exponent = 2
    }
    exponents.set(code, exponent)
  }
  return exponent
}

// "29.00" / 29 / "4500"（JPY）→ 最小单位整数；无法解析返回 null
export function displayToMinor(value: unknown, currency: string | null): number | null {
  if (value === null || value === undefined || value === '') return null
  const amount = typeof value === 'number' ? value : Number(String(value).replace(/,/g, ''))
  if (!Number.isFinite(amount)) return null
  return Math.round(amount * 10 ** currencyExponent(currency ?? 'USD'))
}

export function minorToDisplay(minor: number, currency: string) {
  const exponent = currencyExponent(currency)
  return (minor / 10 ** exponent).toFixed(exponent)
}
