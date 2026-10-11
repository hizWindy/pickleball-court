import { lazy, StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { RecoverBoundary, reloadOnce } from './components/RecoverBoundary'

// The staff desk lives at /admin and is code-split, so players never download it.
const AdminApp = lazy(() => import('./admin/AdminApp'))
const isAdminRoute = window.location.pathname === '/admin' || window.location.pathname.startsWith('/admin/')

// A screen's file that can't be fetched (the site was updated since this page was opened): reload to get the new page.
window.addEventListener('vite:preloadError', () => {
  reloadOnce()
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RecoverBoundary>
      {isAdminRoute ? (
        <Suspense fallback={<div className="min-h-dvh bg-zinc-950" />}>
          <AdminApp />
        </Suspense>
      ) : (
        <App />
      )}
    </RecoverBoundary>
  </StrictMode>,
)
