import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
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
