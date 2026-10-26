import { DashboardSection } from '@/components/home/DashboardSection'
import { useDocumentTitle } from '@/hooks/use-document-title'
import { useAuth } from '@/lib/auth/auth-context'

// Page principale de la zone authentifiée (/app) : point d'entrée après connexion.
// Les blocs affichent un état vide tant que les API de tournois, pronostics,
// classements et groupes ne sont pas livrées.
export default function HomePage() {
  useDocumentTitle('Accueil')
  const { username } = useAuth()

  return (
    <div className="grid w-full max-w-5xl gap-8 self-start">
      <div className="grid gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">
          Bonjour{username ? `, ${username}` : ''}
        </h1>
        <p className="text-muted-foreground">
          Retrouvez ici vos tournois, vos pronostics et vos classements.
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <DashboardSection
          id="live-tournaments"
          title="Tournois en direct"
          description="Les tournois en cours et à venir."
          emptyMessage="Aucun tournoi à afficher pour le moment."
        />
        <DashboardSection
          id="my-predictions"
          title="Mes pronostics"
          description="Vos pronostics et vos réponses aux Pick'em."
          emptyMessage="Vous n'avez encore aucun pronostic."
        />
        <DashboardSection
          id="leaderboard"
          title="Classement général"
          description="Les meilleurs pronostiqueurs."
          emptyMessage="Le classement apparaîtra avec les premiers résultats."
        />
        <DashboardSection
          id="my-groups"
          title="Mes groupes"
          description="Vos groupes d'amis et leur classement."
          emptyMessage="Vous ne faites partie d'aucun groupe."
        />
      </div>
    </div>
  )
}
