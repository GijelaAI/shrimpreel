import { createFileRoute } from '@tanstack/react-router'
import { LegalPage } from '#/components/LegalPage'
import { site } from '#/config/site'
import { getContent, localeFromParam, pageHead } from '#/lib/i18n'

export const Route = createFileRoute('/{-$locale}/refund-policy')({
  head: ({ params }) => {
    const locale = localeFromParam(params.locale)
    const doc = getContent(locale).legal.refund
    return pageHead(locale, '/refund-policy', `${doc.title} – ${site.brandName}`, getContent(locale).meta.refundDescription)
  },
  component: () => <LegalPage doc={(c) => c.legal.refund} />,
})
