import { createFileRoute, useHydrated } from '@tanstack/react-router'
import { CircleCheck, Copy } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { Turnstile } from '#/components/Turnstile'
import { ErrorText, Spinner, formatDate } from '#/components/ui'
import { api, errorCode } from '#/lib/api'
import { useContent, useLocale, useLocalePath } from '#/lib/i18n'
import { useSession } from '#/lib/session'

export const Route = createFileRoute('/{-$locale}/dashboard/settings')({
  component: SettingsPage,
})

function SettingsPage() {
  const c = useContent()
  const s = c.settings
  const locale = useLocale()
  const lp = useLocalePath()
  const { user, signOut } = useSession()
  const [confirmText, setConfirmText] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (!user) return null

  async function deleteAccount() {
    setDeleting(true)
    setError(null)
    try {
      await api('/api/account', { method: 'DELETE' })
      location.href = lp('/')
    } catch (err) {
      setError(errorCode(err))
      setDeleting(false)
    }
  }

  return (
    <div className="max-w-2xl space-y-8">
      <section className="card space-y-4 p-6">
        <h2 className="font-display text-2xl">{s.profile}</h2>
        <dl className="grid grid-cols-[140px_1fr] gap-y-3 text-sm">
          <dt className="text-muted">{s.email}</dt>
          <dd>{user.email}</dd>
          <dt className="text-muted">{s.memberSince}</dt>
          <dd>{formatDate(user.createdAt, locale)}</dd>
        </dl>
        <button
          type="button"
          className="btn-ghost"
          onClick={async () => {
            await signOut()
            location.href = lp('/')
          }}
        >
          {s.signOut}
        </button>
      </section>
      <ReferralCard />
      <RedeemCard />
      <section className="card space-y-4 p-6">
        <h2 className="font-display text-2xl">{s.dataTitle}</h2>
        <p className="text-sm leading-6 text-muted">{s.dataBody}</p>
        <a href="/api/account/export" className="btn-ghost" download data-testid="export-data">
          {s.dataButton}
        </a>
      </section>
      <section className="space-y-4 rounded-2xl border border-red-300 p-6 dark:border-red-900">
        <h2 className="font-display text-2xl text-red-700 dark:text-red-400">{s.dangerTitle}</h2>
        <p className="text-sm leading-6 text-muted">{s.dangerBody}</p>
        <label className="block space-y-1.5 text-sm">
          <span>{s.confirmLabel}</span>
          <input className="input max-w-xs" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} data-testid="delete-confirm" />
        </label>
        <ErrorText code={error} />
        <button type="button" className="btn-danger" disabled={confirmText !== 'DELETE' || deleting} onClick={deleteAccount} data-testid="delete-account">
          {deleting ? <Spinner /> : null} {s.deleteButton}
        </button>
      </section>
    </div>
  )
}

type Referral = { enabled: false } | { enabled: true; url: string; rewardCredits: number; invited: number; rewarded: number; credits: number }

// 邀请好友：关闭邀请奖励（site.referralRewardCredits = 0）或加载失败时不显示
function ReferralCard() {
  const s = useContent().settings
  const [referral, setReferral] = useState<Referral | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    api<Referral>('/api/referral')
      .then(setReferral)
      .catch(() => setReferral(null))
  }, [])

  if (!referral?.enabled) return null
  const { url } = referral

  async function copy() {
    await navigator.clipboard.writeText(url)
    setCopied(true)
  }

  return (
    <section className="card space-y-4 p-6" data-testid="referral-card">
      <h2 className="font-display text-2xl">{s.referralTitle}</h2>
      <p className="text-sm leading-6 text-muted">{s.referralBody(referral.rewardCredits)}</p>
      <div className="flex flex-wrap gap-2">
        <input className="input max-w-sm font-mono text-sm" readOnly value={url} aria-label={s.referralTitle} onFocus={(e) => e.target.select()} data-testid="referral-link" />
        <button type="button" className="btn-ghost" onClick={copy}>
          {copied ? <CircleCheck className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />} {copied ? s.referralCopied : s.referralCopy}
        </button>
      </div>
      <p className="text-sm text-muted" data-testid="referral-stats">
        {s.referralStats(referral.invited, referral.rewarded, referral.credits)}
      </p>
    </section>
  )
}

// 兑换码：成功后刷新会话里的余额；失败或成功都要换一个 Turnstile token（单次有效）
function RedeemCard() {
  const c = useContent()
  const s = c.settings
  const locale = useLocale()
  const { config, refresh } = useSession()
  const hydrated = useHydrated()
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ credits: number; expiresAt: string | null } | null>(null)
  const [token, setToken] = useState<string | null>(null)
  const [resetKey, setResetKey] = useState(0)
  const siteKey = config?.turnstileSiteKey ?? null

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    setResult(null)
    try {
      setResult(await api<{ credits: number; expiresAt: string | null }>('/api/redeem', { json: { code, turnstileToken: token } }))
      setCode('')
      await refresh()
    } catch (err) {
      setError(errorCode(err))
    } finally {
      setBusy(false)
      setToken(null)
      setResetKey((n) => n + 1)
    }
  }

  return (
    <section className="card space-y-4 p-6">
      <h2 className="font-display text-2xl">{s.redeemTitle}</h2>
      <p className="text-sm leading-6 text-muted">{s.redeemBody}</p>
      <form onSubmit={submit} className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <input
            className="input max-w-xs font-mono uppercase"
            required
            maxLength={40}
            autoComplete="off"
            spellCheck={false}
            placeholder="XXXX-XXXX-XXXX"
            aria-label={s.redeemTitle}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            data-testid="redeem-code"
          />
          <button type="submit" className="btn-primary" disabled={!hydrated || busy || !code.trim() || Boolean(siteKey && !token)} data-testid="redeem-submit">
            {busy ? <Spinner /> : null} {s.redeemButton}
          </button>
        </div>
        {siteKey ? <Turnstile siteKey={siteKey} onToken={setToken} resetKey={resetKey} /> : null}
      </form>
      {result ? (
        <p className="flex items-center gap-2 text-sm font-medium" data-testid="redeem-success">
          <CircleCheck className="size-5 text-emerald-600" /> {s.redeemSuccess(result.credits, result.expiresAt ? formatDate(result.expiresAt, locale) : null)}
        </p>
      ) : null}
      <ErrorText code={error} />
    </section>
  )
}
