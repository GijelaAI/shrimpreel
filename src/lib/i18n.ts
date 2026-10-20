import { useRouterState } from '@tanstack/react-router'
import { DEFAULT_LOCALE, LOCALE_META, LOCALES, isLocale, localePath, site, type Locale } from '#/config/site'
import type { Content } from '#/content/en'

// 文案按语言拆包：每种语言一个 chunk，浏览器只下载当前语言。加载时机：
// - 服务端渲染和客户端路由跳转：根路由 beforeLoad（routes/__root.tsx）
// - 浏览器首屏：router 模块执行时就开始下载，水合前由 router 的 hydrate 钩子等它完成（src/router.tsx）
// 加载完成后 getContent / useContent 同步可用
const loaders: Record<Locale, () => Promise<(s: typeof site) => Content>> = {
  en: () => import('#/content/en').then((m) => m.en),
  zh: () => import('#/content/zh').then((m) => m.zh),
}
const cache = new Map<Locale, Content>()
const pending = new Map<Locale, Promise<Content>>()

export function loadContent(locale: Locale): Promise<Content> {
  const loaded = cache.get(locale)
  if (loaded) return Promise.resolve(loaded)
  let promise = pending.get(locale)
  if (!promise) {
    promise = loaders[locale]().then((factory) => {
      const content = factory(site)
      cache.set(locale, content)
      return content
    })
    // 下载失败（断网、部署后旧 chunk 不存在）时允许下次重试
    promise.catch(() => pending.delete(locale))
    pending.set(locale, promise)
  }
  return promise
}

export function getContent(locale: Locale): Content {
  const content = cache.get(locale)
  if (content) return content
  // 客户端跳到另一种语言时，地址先变、新文案还在下载，旧页面会按新地址再渲染一次：先用已加载的语言顶上
  const fallback = import.meta.env.SSR ? undefined : cache.values().next().value
  if (fallback) return fallback
  throw new Error(`Content for "${locale}" is not loaded yet; await loadContent() first`)
}

export function localeFromParam(param: string | undefined): Locale {
  return isLocale(param) ? param : DEFAULT_LOCALE
}

// 默认语言不带前缀：/pricing、/zh/pricing
export function localeFromPathname(pathname: string): Locale {
  const first = pathname.split('/')[1]
  return isLocale(first) && first !== DEFAULT_LOCALE ? first : DEFAULT_LOCALE
}

export function stripLocale(pathname: string) {
  const locale = localeFromPathname(pathname)
  if (locale === DEFAULT_LOCALE) return pathname || '/'
  const rest = pathname.slice(locale.length + 1)
  return rest || '/'
}

export function switchLocalePath(pathname: string, target: Locale) {
  return localePath(target, stripLocale(pathname))
}

export function htmlLang(locale: Locale) {
  return LOCALE_META[locale].tag
}

export function useLocale(): Locale {
  return useRouterState({ select: (s) => localeFromPathname(s.location.pathname) })
}

export function useContent(): Content {
  return getContent(useLocale())
}

export function useLocalePath() {
  const locale = useLocale()
  return (path: string) => localePath(locale, path)
}

export function absoluteUrl(path: string) {
  return `https://${site.domain}${path === '/' ? '' : path}`
}

// 每个页面的 SEO head：title/description/canonical/hreflang/OG
export function pageHead(locale: Locale, path: string, title: string, description: string) {
  const canonical = absoluteUrl(localePath(locale, path))
  return {
    meta: [
      { title },
      { name: 'description', content: description },
      { property: 'og:title', content: title },
      { property: 'og:description', content: description },
      { property: 'og:url', content: canonical },
      { property: 'og:locale', content: LOCALE_META[locale].ogLocale },
      { property: 'og:image:alt', content: getContent(locale).meta.ogImageAlt },
      { name: 'twitter:title', content: title },
      { name: 'twitter:description', content: description },
    ],
    links: [
      { rel: 'canonical', href: canonical },
      ...LOCALES.map((l) => ({ rel: 'alternate', hrefLang: l, href: absoluteUrl(localePath(l, path)) })),
      { rel: 'alternate', hrefLang: 'x-default', href: absoluteUrl(localePath(DEFAULT_LOCALE, path)) },
    ],
  }
}
