import { useEffect } from 'react'
import { Route, Routes, useLocation } from 'react-router'
import { AuthPage } from '@/features/auth/auth-page'
import { ProtectedHomePage } from '@/features/auth/protected-home-page'
import { GuestOnly, RequireAuth, SessionGate } from '@/routes/auth-guards'
import { NotFoundPage } from '@/routes/not-found-page'
import { WelcomePage } from '@/routes/welcome-page'

function RouteFocus() {
  const { pathname } = useLocation()
  useEffect(() => {
    const title = pathname === '/' ? 'Your next move'
      : pathname === '/login' ? 'Sign in'
        : pathname === '/register' ? 'Create account'
          : pathname === '/play' ? 'Your chess space' : 'Page not found'
    document.title = `${title} · Chess`
    document.querySelector<HTMLElement>('main')?.focus()
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
          <Route path="/play" element={<ProtectedHomePage />} />
        </Route>
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
      <RouteFocus />
    </SessionGate>
  )
}
