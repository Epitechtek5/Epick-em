import { useState } from 'react'
import { useSearchParams } from 'react-router'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useDocumentTitle } from '@/hooks/use-document-title'
import { ApiError, apiRequest } from '@/lib/api/client'

export default function VerifyEmailPage() {
  useDocumentTitle('Confirmer mon adresse e-mail')
  const [params] = useSearchParams()
  const values = params.getAll('token')
  const token = values.length === 1 ? values[0] : ''
  return <Confirmation key={token} token={token} />
}

function Confirmation({ token }: { token: string }) {
  const [status, setStatus] = useState<'ready' | 'sending' | 'success' | 'invalid' | 'retry'>(
    token ? 'ready' : 'invalid',
  )

  async function confirm() {
    setStatus('sending')
    try {
      await apiRequest('/verify-email', {
        method: 'POST', body: { token }, skipAuth: true, expectedStatus: 204,
      })
      setStatus('success')
    } catch (error) {
      setStatus(error instanceof ApiError && error.status === 400 ? 'invalid' : 'retry')
    }
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>{status === 'success' ? 'Adresse e-mail confirmée' : 'Confirmer mon adresse e-mail'}</CardTitle>
        <CardDescription aria-live="polite">
          {status === 'success' ? 'Vous pouvez maintenant vous connecter dans Epick’em.'
            : status === 'invalid' ? 'Lien invalide, expiré ou déjà utilisé. Demandez un nouveau lien dans l’application.'
            : 'Confirmez votre adresse pour votre compte Epick’em. Ce lien est valable 15 minutes.'}
        </CardDescription>
      </CardHeader>
      {status !== 'success' && status !== 'invalid' && (
        <CardContent className="grid gap-3">
          {status === 'retry' && <p role="alert">La confirmation a échoué. Réessayez dans un instant.</p>}
          <Button disabled={status === 'sending'} onClick={confirm}>
            {status === 'sending' ? 'Confirmation en cours…' : 'Confirmer mon adresse'}
          </Button>
          {status !== 'sending' && <Button asChild variant="outline">
            <a href={`epickem://verify-email?token=${encodeURIComponent(token)}`}>Ouvrir dans l’application mobile</a>
          </Button>}
        </CardContent>
      )}
    </Card>
  )
}
