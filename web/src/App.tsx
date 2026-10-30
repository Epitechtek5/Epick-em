import { Navigate, Route, Routes } from 'react-router'

import { AdminRoute } from '@/components/auth/AdminRoute'
import { GuestRoute } from '@/components/auth/GuestRoute'
import { ProtectedRoute } from '@/components/auth/ProtectedRoute'
import { AppShell } from '@/components/layout/AppShell'
import GameDetailsPage from '@/pages/GameDetailsPage'
import GameEditorPage from '@/pages/GameEditorPage'
import GameTransferPage from '@/pages/GameTransferPage'
import GamesPage from '@/pages/GamesPage'
import HomePage from '@/pages/HomePage'
import LoginPage from '@/pages/LoginPage'
import NotFoundPage from '@/pages/NotFoundPage'
import RegisterPage from '@/pages/RegisterPage'

export default function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<Navigate to="/app" replace />} />
        <Route element={<GuestRoute />}>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
        </Route>
        <Route element={<ProtectedRoute />}>
          <Route path="/app" element={<HomePage />} />
          <Route path="/games" element={<GamesPage />} />
          <Route element={<AdminRoute />}>
            <Route path="/games/new" element={<GameEditorPage />} />
            <Route path="/games/transfer" element={<GameTransferPage />} />
            <Route path="/games/:id/edit" element={<GameEditorPage />} />
          </Route>
          <Route path="/games/:id" element={<GameDetailsPage />} />
        </Route>
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  )
}
