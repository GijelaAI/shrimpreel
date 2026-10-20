import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect, useState, type FormEvent } from 'react'
import { ErrorText, GoogleIcon, LocalLink, LogoMark, Spinner } from '#/components/ui'
import { api, errorCode } from '#/lib/api'
import { getContent, localeFromParam, pageHead, useContent, useLocalePath } from '#/lib/i18n'
import { safeRedirectPath } from '#/lib/redirect'
import { useSession } from '#/lib/session'

type Search = { redirect?: string; error?: string }

export const Route = createFileRoute('/{-$locale}/sign-in')({
  validateSearch: (search: Record<string, unknown>): Search => ({
    redirect: typeof search.redirect === 'string' ? search.redirect : undefined,
    error: typeof search.error === 'string' ? search.error : undefined,
  }),
  head: ({ params }) => {
    const locale = localeFromParam(params.locale)
    const c = getContent(locale)
    const head = pageHead(locale, '/sign-in', c.meta.signInTitle, c.signIn.body)
    return { ...head, meta: [...head.meta, { name: 'robots', content: 'noindex' }] }
  },
  component: SignInPage,
})

function SignInPage() {
  const c = useContent()
  const t = c.signIn
  const lp = useLocalePath()
  const search = Route.useSearch()
  const navigate = useNavigate()
  const { user, config, loading, refresh } = useSession()
  const redirect = safeRedirectPath(search.redirect, lp('/dashboard'))
  const [email, setEmail] = useState('demo@example.com')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(search.error ?? null)

  useEffect(() => {
    if (user) void navigate({ href: redirect })
  }, [user, redirect, navigate])

  async function devLogin(event: FormEvent) {
    event.preventDefault()
    setPending(true)
    setError(null)
    try {
      await api('/api/auth/dev-login', { json: { email } })
      await refresh()
    } catch (err) {
      setError(errorCode(err))
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="container-page grid max-w-md place-items-center py-20">
      <div className="card w-full space-y-6 p-8 text-center">
        <LogoMark className="mx-auto size-12 text-base" />
        <div className="space-y-2">
          <h1 className="font-display text-3xl">{t.title}</h1>
          <p className="text-sm text-muted">{t.body}</p>
        </div>
        {loading ? (
          <Spinner className="mx-auto size-5" />
        ) : config?.googleClientId ? (
          <a href={`/api/auth/google/start?redirect=${encodeURIComponent(redirect)}`} className="btn-primary w-full py-3.5">
            <GoogleIcon /> {t.google}
          </a>
        ) : (
          <p className="text-sm text-muted">{t.notConfigured}</p>
        )}
        {config?.devLogin ? (
          <form onSubmit={devLogin} className="space-y-3 border-t border-line pt-6 text-left">
            <p className="text-xs font-semibold tracking-wide text-muted uppercase">{t.devTitle}</p>
            <label className="block space-y-1.5 text-sm">
              <span>{t.devEmail}</span>
              <input className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} data-testid="dev-email" />
            </label>
            <button type="submit" className="btn-ghost w-full" disabled={pending} data-testid="dev-login">
              {pending ? <Spinner /> : null} {t.devSubmit}
            </button>
          </form>
        ) : null}
        <ErrorText code={error} />
        <p className="text-xs text-muted">
          <LocalLink to="/terms-of-service" className="underline">
            {t.legal}
          </LocalLink>
        </p>
      </div>
    </div>
  )
}
