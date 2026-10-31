import { lazy } from 'react'
import { Outlet, Route, Routes } from 'react-router'
import { AuthPage } from '@/features/auth/auth-page'
import { PlayPage } from '@/features/play/play-page'
import { AppLayout } from '@/routes/app-layout'
import { GuestOnly, RequireAuth, SessionGate } from '@/routes/auth-guards'
import { NotFoundPage } from '@/routes/not-found-page'
import { WelcomePage } from '@/routes/welcome-page'
import { RouteFocus } from '@/routes/route-focus'
import { ServerWakeNotice } from '@/components/server-wake-notice'

const HistoryPage = lazy(() => import('@/features/history/history-page').then((module) => ({ default: module.HistoryPage })))
const SavedGamePage = lazy(() => import('@/features/history/saved-game-page').then((module) => ({ default: module.SavedGamePage })))
const AnalysisPage = lazy(() => import('@/features/analysis/analysis-page').then((module) => ({ default: module.AnalysisPage })))
const AnalysisDetailPage = lazy(() => import('@/features/analysis/analysis-detail-page').then((module) => ({ default: module.AnalysisDetailPage })))

function PublicPage() {
  return <><Outlet /><RouteFocus /></>
}

export default function App() {
  return (
    <>
      <ServerWakeNotice />
      <SessionGate>
        <Routes>
          <Route element={<PublicPage />}>
            <Route path="/" element={<WelcomePage />} />
            <Route element={<GuestOnly />}>
              <Route path="/login" element={<AuthPage mode="login" />} />
              <Route path="/register" element={<AuthPage mode="register" />} />
            </Route>
            <Route path="*" element={<NotFoundPage />} />
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
        </Routes>
      </SessionGate>
    </>
  )
}
