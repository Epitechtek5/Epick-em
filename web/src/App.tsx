import { Button } from '@/components/ui/button'

export default function App() {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-4 p-6">
      <h1 className="text-3xl font-semibold tracking-tight">Epick'em</h1>
      <p className="text-muted-foreground">
        Plateforme de tournois et de pronostics en temps réel.
      </p>
      <Button>Commencer</Button>
    </main>
  )
}
