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
import MatchDetailsPage from '@/pages/MatchDetailsPage'
import MatchEditorPage from '@/pages/MatchEditorPage'
import NotFoundPage from '@/pages/NotFoundPage'
import RegisterPage from '@/pages/RegisterPage'
import StatEditorPage from '@/pages/StatEditorPage'
import StatTransferPage from '@/pages/StatTransferPage'
import StatsPage from '@/pages/StatsPage'
import StepBracketPage from '@/pages/StepBracketPage'
import StepDetailsPage from '@/pages/StepDetailsPage'
import StepEditorPage from '@/pages/StepEditorPage'
import TeamDetailsPage from '@/pages/TeamDetailsPage'
import TeamEditorPage from '@/pages/TeamEditorPage'
import TeamTransferPage from '@/pages/TeamTransferPage'
import TeamsPage from '@/pages/TeamsPage'
import TournamentTeamCopyPage from '@/pages/TournamentTeamCopyPage'
import TournamentTeamDetailsPage from '@/pages/TournamentTeamDetailsPage'
import TournamentTeamEditorPage from '@/pages/TournamentTeamEditorPage'
import TournamentTeamsPage from '@/pages/TournamentTeamsPage'
import TournamentDetailsPage from '@/pages/TournamentDetailsPage'
import TournamentEditorPage from '@/pages/TournamentEditorPage'
import TournamentTransferPage from '@/pages/TournamentTransferPage'
import TournamentsPage from '@/pages/TournamentsPage'

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
            <Route path="/stats/new" element={<StatEditorPage />} />
            <Route path="/stats/transfer" element={<StatTransferPage />} />
            <Route path="/stats/:id/edit" element={<StatEditorPage />} />
            <Route path="/teams/transfer" element={<TeamTransferPage />} />
            <Route path="/tournaments/new" element={<TournamentEditorPage />} />
            <Route path="/tournaments/transfer" element={<TournamentTransferPage />} />
            <Route path="/tournaments/:id/edit" element={<TournamentEditorPage />} />
            <Route path="/tournaments/:tournamentId/steps/new" element={<StepEditorPage />} />
            <Route path="/tournaments/:tournamentId/steps/:stepId/edit" element={<StepEditorPage />} />
            <Route path="/tournaments/:tournamentId/steps/:stepId/matches/new" element={<MatchEditorPage />} />
            <Route path="/tournaments/:tournamentId/steps/:stepId/matches/:matchId/edit" element={<MatchEditorPage />} />
          </Route>
          <Route path="/games/:id" element={<GameDetailsPage />} />
          <Route path="/stats" element={<StatsPage />} />
          {/* Équipes globales : création ouverte à tout compte, gestion réservée au propriétaire. */}
          <Route path="/teams" element={<TeamsPage />} />
          <Route path="/teams/new" element={<TeamEditorPage />} />
          <Route path="/teams/:id" element={<TeamDetailsPage />} />
          <Route path="/teams/:id/edit" element={<TeamEditorPage />} />
          {/* Tournois : consultation et inscription ouvertes à tout compte connecté. */}
          <Route path="/tournaments" element={<TournamentsPage />} />
          <Route path="/tournaments/:id" element={<TournamentDetailsPage />} />
          {/* Équipes de tournoi : l'UUID du tournoi vient de l'URL. */}
          <Route path="/tournaments/:tournamentId/steps/:stepId" element={<StepDetailsPage />} />
          <Route path="/tournaments/:tournamentId/steps/:stepId/bracket" element={<StepBracketPage />} />
          <Route path="/tournaments/:tournamentId/steps/:stepId/matches/:matchId" element={<MatchDetailsPage />} />
          <Route path="/tournaments/:tournamentId/teams" element={<TournamentTeamsPage />} />
          <Route path="/tournaments/:tournamentId/teams/new" element={<TournamentTeamEditorPage />} />
          <Route path="/tournaments/:tournamentId/teams/copy" element={<TournamentTeamCopyPage />} />
          <Route path="/tournament-teams/:id" element={<TournamentTeamDetailsPage />} />
          <Route path="/tournament-teams/:id/edit" element={<TournamentTeamEditorPage />} />
        </Route>
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  )
}
