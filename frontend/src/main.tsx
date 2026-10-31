import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import './index.css'
import App from './App.tsx'
import { ErrorBoundary } from './components/error-boundary.tsx'
import { warmServer } from './lib/server-wake.ts'

warmServer()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <ErrorBoundary fullPage><App /></ErrorBoundary>
    </BrowserRouter>
  </StrictMode>,
)
