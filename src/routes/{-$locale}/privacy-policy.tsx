import { createFileRoute } from '@tanstack/react-router'
import { LegalPage } from '#/components/LegalPage'
import { site } from '#/config/site'
import { getContent, localeFromParam, pageHead } from '#/lib/i18n'

export const Route = createFileRoute('/{-$locale}/privacy-policy')({
  head: ({ params }) => {
    const locale = localeFromParam(params.locale)
    const doc = getContent(locale).legal.privacy
    return pageHead(locale, '/privacy-policy', `${doc.title} – ${site.brandName}`, getContent(locale).meta.privacyDescription)
  },
  component: () => <LegalPage doc={(c) => c.legal.privacy} />,
})
