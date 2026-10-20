import { ArrowRight, Plus } from 'lucide-react'
import { articlePath } from '#/config/site'
import { useContent } from '#/lib/i18n'
import { LocalLink } from './ui'

export function Faq() {
  const f = useContent().faq
  return (
    <div className="grid gap-10 md:grid-cols-[1fr_1.6fr]">
      <div className="space-y-4">
        <h2 className="font-display text-4xl leading-tight">{f.title}</h2>
        <p className="text-muted">{f.body}</p>
        <LocalLink to="/contact" className="btn-ghost">
          {f.cta}
        </LocalLink>
      </div>
      <div className="divide-y divide-line border-y border-line">
        {f.items.map((item) => (
          <details key={item.q} className="group py-5">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-left font-medium">
              {item.q}
              <Plus className="size-4 shrink-0 transition group-open:rotate-45" />
            </summary>
            <p className="mt-3 leading-7 text-muted">{item.a}</p>
            {item.guide ? (
              <LocalLink to={articlePath(item.guide.article)} className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold hover:text-accent">
                {item.guide.label} <ArrowRight className="size-4" />
              </LocalLink>
            ) : null}
          </details>
        ))}
      </div>
    </div>
  )
}

export function faqJsonLd(items: { q: string; a: string }[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map((item) => ({
      '@type': 'Question',
      name: item.q,
      acceptedAnswer: { '@type': 'Answer', text: item.a },
    })),
  }
}
