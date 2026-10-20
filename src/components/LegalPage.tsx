import type { Content } from '#/content/en'
import { useContent } from '#/lib/i18n'

type Doc = Content['legal']['privacy']

export function LegalPage({ doc }: { doc: (c: Content) => Doc }) {
  const c = useContent()
  const page = doc(c)
  return (
    <article className="container-page max-w-3xl py-16">
      <h1 className="font-display text-5xl">{page.title}</h1>
      <p className="mt-3 text-sm text-muted">
        {c.common.lastUpdated}: {c.legal.updated}
      </p>
      <div className="prose-article mt-8">
        {page.sections.map((section) => (
          <section key={section.h}>
            <h2>{section.h}</h2>
            {section.p.map((text) => (
              <p key={text}>{text}</p>
            ))}
          </section>
        ))}
      </div>
    </article>
  )
}
