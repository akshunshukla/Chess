import { useEffect } from 'react'
import { useLocation } from 'react-router'

const pageTitles: Record<string, string> = {
  '/': 'Your next move',
  '/login': 'Sign in',
  '/register': 'Create account',
  '/play': 'Play',
  '/history': 'History',
  '/analysis': 'Analysis',
}

// Render inside the page's Suspense boundary, so focus moves after it is ready.
export function RouteFocus() {
  const { pathname } = useLocation()
  useEffect(() => {
    const path = pathname.replace(/\/+$/, '').toLowerCase() || '/'
    const title = pageTitles[path] ?? (/^\/history\/[^/]+$/.test(path) ? 'Saved game'
      : /^\/analysis\/[^/]+$/.test(path) ? 'Analysis results' : 'Page not found')
    document.title = `${title} · Chess`
    if (document.querySelector('[role="dialog"][data-state="open"]')) return
    document.querySelector<HTMLElement>('main')?.focus({ preventScroll: true })
    window.scrollTo(0, 0)
  }, [pathname])
  return null
}
