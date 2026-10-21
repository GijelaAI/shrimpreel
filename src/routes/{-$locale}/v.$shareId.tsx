import { createFileRoute } from '@tanstack/react-router'
import { getGlobalStartContext } from '@tanstack/react-start'
import { AiBadge } from '#/components/ui'
import { api } from '#/lib/api'
import { absoluteUrl, getContent, localeFromParam, pageHead, useContent, useLocalePath } from '#/lib/i18n'
import type { ShareView } from '#/server/shares'

// 成片公开分享页 /v/<shareId>：用户自己开启（个人中心“分享”），只放视频、AI 标识、行动按钮和举报入口，
// 不显示作者信息。一律 noindex；失效的链接由 src/server.ts 改成 404/410
export const Route = createFileRoute('/{-$locale}/v/$shareId')({
  loader: async ({ params }) => ({ share: await fetchShare(params.shareId) }),
  head: ({ params, loaderData }) => {
    const locale = localeFromParam(params.locale)
    const t = getContent(locale).share
    const share = loaderData?.share
    const ok = share?.state === 'ok'
    const head = pageHead(locale, `/v/${params.shareId}`, ok ? t.title : t.goneTitle, t.description)
    const meta = [...head.meta, { name: 'robots', content: 'noindex' }]
    if (ok) {
      const video = absoluteUrl(share.videoUrl)
      meta.push(
        { property: 'og:type', content: 'video.other' },
        { property: 'og:video', content: video },
        { property: 'og:video:secure_url', content: video },
        { property: 'og:video:type', content: 'video/mp4' },
      )
      // 封面固定 1200×630，和根路由里默认 OG 图的宽高声明一致
      if (share.posterUrl) {
        meta.push({ property: 'og:image', content: absoluteUrl(share.posterUrl) }, { name: 'twitter:image', content: absoluteUrl(share.posterUrl) })
      }
    }
    return { ...head, meta }
  },
  component: SharePage,
})

// 服务端渲染时用 src/server.ts 查好的数据（和 HTTP 状态码一致）；浏览器内跳转时走接口
async function fetchShare(shareId: string): Promise<ShareView> {
  if (typeof window === 'undefined') {
    const context = getGlobalStartContext() as { share?: ShareView } | undefined
    return context?.share ?? { state: 'missing' }
  }
  try {
    return (await api<{ share: ShareView }>(`/api/shares/${encodeURIComponent(shareId)}`)).share
  } catch {
    return { state: 'missing' }
  }
}

function SharePage() {
  const { share } = Route.useLoaderData()
  const t = useContent().share
  const lp = useLocalePath()

  if (share.state !== 'ok') {
    return (
      <section className="container-page max-w-xl py-24 text-center" data-testid="share-gone" data-state={share.state}>
        <h1 className="font-display text-4xl">{t.gone[share.state]}</h1>
        <p className="mt-4 text-muted">{t.goneBody}</p>
        <a href={`${lp('/')}#create`} className="btn-primary mt-8">
          {t.cta}
        </a>
      </section>
    )
  }

  const reportHref = `${lp('/report')}?content=${encodeURIComponent(absoluteUrl(lp(`/v/${share.id}`)))}`
  return (
    <section className="container-page grid max-w-5xl gap-10 py-16 md:grid-cols-[minmax(0,360px)_1fr] md:items-center" data-testid="share-page">
      <div className="relative mx-auto aspect-[9/16] w-full max-w-[360px] overflow-hidden rounded-2xl bg-black shadow-sm ring-1 ring-line">
        <AiBadge />
        <video src={share.videoUrl} controls playsInline preload="metadata" className="size-full object-contain" data-testid="share-video" />
      </div>
      <div>
        <h1 className="font-display text-4xl leading-tight md:text-5xl">{t.heading}</h1>
        <p className="mt-4 text-lg text-muted">{t.body}</p>
        <p className="mt-3 text-sm text-muted">{t.disclosure}</p>
        <a href={`${lp('/')}#create`} className="btn-primary mt-8">
          {t.cta}
        </a>
        <p className="mt-10 text-xs text-muted">
          {t.reportPrompt}{' '}
          <a href={reportHref} className="underline underline-offset-2" data-testid="share-report">
            {t.report}
          </a>
        </p>
      </div>
    </section>
  )
}
