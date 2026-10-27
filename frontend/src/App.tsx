import { useEffect } from 'react'
import { Route, Routes, useLocation } from 'react-router'
import { AuthPage } from '@/features/auth/auth-page'
import { AnalysisPage } from '@/features/analysis/analysis-page'
import { HistoryPage } from '@/features/history/history-page'
import { PlayPage } from '@/features/play/play-page'
import { AppLayout } from '@/routes/app-layout'
import { GuestOnly, RequireAuth, SessionGate } from '@/routes/auth-guards'
import { NotFoundPage } from '@/routes/not-found-page'
import { WelcomePage } from '@/routes/welcome-page'

const pageTitles: Record<string, string> = {
  '/': 'Your next move',
  '/login': 'Sign in',
  '/register': 'Create account',
  '/play': 'Play',
  '/history': 'History',
  '/analysis': 'Analysis',
}

function RouteFocus() {
  const { pathname } = useLocation()
  useEffect(() => {
    const path = pathname.replace(/\/+$/, '').toLowerCase() || '/'
    const title = pageTitles[path] ?? 'Page not found'
    document.title = `${title} · Chess`
    document.querySelector<HTMLElement>('main')?.focus()
    window.scrollTo(0, 0)
  }, [pathname])
  return null
}

export default function App() {
  return (
    <SessionGate>
      <Routes>
        <Route path="/" element={<WelcomePage />} />
        <Route element={<GuestOnly />}>
          <Route path="/login" element={<AuthPage mode="login" />} />
          <Route path="/register" element={<AuthPage mode="register" />} />
        </Route>
        <Route element={<RequireAuth />}>
          <Route element={<AppLayout />}>
            <Route path="/play" element={<PlayPage />} />
            <Route path="/history" element={<HistoryPage />} />
            <Route path="/analysis" element={<AnalysisPage />} />
          </Route>
        </Route>
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
      <RouteFocus />
    </SessionGate>
  )
}
