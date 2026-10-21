import { Link } from 'react-router'

import { useDocumentTitle } from '@/hooks/use-document-title'

export default function NotFoundPage() {
  useDocumentTitle('Page introuvable')

  return (
    <div className="grid gap-4 text-center">
      <h1 className="text-2xl font-semibold">Page introuvable</h1>
      <p className="text-muted-foreground">Cette adresse n'existe pas.</p>
      <Link to="/" className="text-primary underline underline-offset-2">
        Retour à l'accueil
      </Link>
    </div>
  )
}
