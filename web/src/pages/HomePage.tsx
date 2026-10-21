import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { useDocumentTitle } from '@/hooks/use-document-title'
import { useAuth } from '@/lib/auth/auth-context'

// Page de départ de la zone authentifiée (contenu à venir).
export default function HomePage() {
  useDocumentTitle('Accueil')
  const { username, logout } = useAuth()

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>Bienvenue{username ? `, ${username}` : ''}</CardTitle>
        <CardDescription>Vous êtes connecté.</CardDescription>
      </CardHeader>
      <CardContent />
      <CardFooter>
        <Button variant="outline" onClick={logout}>
          Se déconnecter
        </Button>
      </CardFooter>
    </Card>
  )
}
