import { lazy, useEffect } from 'react'
import { Route, Routes, useLocation } from 'react-router'
import { AuthPage } from '@/features/auth/auth-page'
import { PlayPage } from '@/features/play/play-page'
import { AppLayout } from '@/routes/app-layout'
import { GuestOnly, RequireAuth, SessionGate } from '@/routes/auth-guards'
import { NotFoundPage } from '@/routes/not-found-page'
import { WelcomePage } from '@/routes/welcome-page'

const HistoryPage = lazy(() => import('@/features/history/history-page').then((module) => ({ default: module.HistoryPage })))
const SavedGamePage = lazy(() => import('@/features/history/saved-game-page').then((module) => ({ default: module.SavedGamePage })))
const AnalysisPage = lazy(() => import('@/features/analysis/analysis-page').then((module) => ({ default: module.AnalysisPage })))
const AnalysisDetailPage = lazy(() => import('@/features/analysis/analysis-detail-page').then((module) => ({ default: module.AnalysisDetailPage })))

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
    const title = pageTitles[path] ?? (/^\/history\/[^/]+$/.test(path) ? 'Saved game'
      : /^\/analysis\/[^/]+$/.test(path) ? 'Analysis results' : 'Page not found')
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
            <Route path="/history/:gameId" element={<SavedGamePage />} />
            <Route path="/analysis" element={<AnalysisPage />} />
            <Route path="/analysis/:analysisId" element={<AnalysisDetailPage />} />
          </Route>
        </Route>
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
      <RouteFocus />
    </SessionGate>
  )
}
