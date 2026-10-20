import { createFileRoute } from '@tanstack/react-router'
import { ArticleCards } from '#/components/ArticleCards'
import { Breadcrumbs } from '#/components/ui'
import { ARTICLES } from '#/config/site'
import { getContent, localeFromParam, pageHead, useContent } from '#/lib/i18n'
import { breadcrumbJsonLd, jsonLdScript } from '#/lib/seo'

// 文章列表（内链枢纽）：导航和页脚都链到这里，每篇文章离任意页面最多两次点击
export const Route = createFileRoute('/{-$locale}/guides')({
  head: ({ params }) => {
    const locale = localeFromParam(params.locale)
    const c = getContent(locale)
    return {
      ...pageHead(locale, '/guides', c.guides.metaTitle, c.guides.description),
      scripts: [jsonLdScript(breadcrumbJsonLd(locale, c.meta.breadcrumbHome, [{ name: c.guides.title, path: '/guides' }]))],
    }
  },
  component: GuidesPage,
})

function GuidesPage() {
  const c = useContent()
  return (
    <div className="container-page max-w-4xl py-16">
      <Breadcrumbs items={[{ name: c.guides.title, path: '/guides' }]} />
      <h1 className="font-display text-5xl leading-tight">{c.guides.title}</h1>
      <p className="mt-4 max-w-2xl text-lg leading-8 text-muted">{c.guides.intro}</p>
      <div className="mt-10">
        <ArticleCards articles={ARTICLES} headingLevel={2} />
      </div>
    </div>
  )
}
