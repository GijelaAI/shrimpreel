import { Outlet, createFileRoute } from '@tanstack/react-router'
import { Footer, SupportButton } from '#/components/Footer'
import { Nav } from '#/components/Nav'
import { DEFAULT_LOCALE, isLocale } from '#/config/site'

// 语言布局：/ 与 /zh 共用。默认语言不允许带前缀（/en/... → 404，避免重复内容）
// params.parse 返回 false 时路由不参与匹配，未知前缀（/fr、/en）会落到根 404
export const Route = createFileRoute('/{-$locale}')({
  params: {
    parse: (raw) => (raw.locale === undefined || (isLocale(raw.locale) && raw.locale !== DEFAULT_LOCALE) ? raw : false),
  },
  component: LocaleLayout,
})

function LocaleLayout() {
  return (
    <>
      <Nav />
      <main className="min-h-[60vh]">
        <Outlet />
      </main>
      <Footer />
      <SupportButton />
    </>
  )
}
