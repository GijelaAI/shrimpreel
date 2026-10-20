import { createFileRoute } from '@tanstack/react-router'
import { LegalPage } from '#/components/LegalPage'
import { site } from '#/config/site'
import { getContent, localeFromParam, pageHead } from '#/lib/i18n'

export const Route = createFileRoute('/{-$locale}/terms-of-service')({
  head: ({ params }) => {
    const locale = localeFromParam(params.locale)
    const doc = getContent(locale).legal.terms
    return pageHead(locale, '/terms-of-service', `${doc.title} – ${site.brandName}`, getContent(locale).meta.termsDescription)
  },
  component: () => <LegalPage doc={(c) => c.legal.terms} />,
})
