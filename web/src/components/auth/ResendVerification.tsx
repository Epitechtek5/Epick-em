import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { useI18n } from '@/i18n/context'
import { resendVerificationEmail } from '@/lib/api/auth'
import { NetworkError } from '@/lib/api/client'

type Status = 'idle' | 'sending' | 'sent' | 'network' | 'error'

// Renvoie le lien de confirmation d'adresse. La réponse du serveur est neutre (204) :
// le message ne dit jamais si l'adresse correspond à un compte.
export function ResendVerification({ email }: { email: string }) {
  const { t } = useI18n()
  const [status, setStatus] = useState<Status>('idle')

  async function resend() {
    setStatus('sending')
    try {
      await resendVerificationEmail(email)
      setStatus('sent')
    } catch (error) {
      setStatus(error instanceof NetworkError ? 'network' : 'error')
    }
  }

  return (
    <div className="grid gap-2">
      {status === 'sent' ? (
        <p role="status" className="text-sm">
          {t('auth.resend.sent')}
        </p>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="justify-self-start"
          disabled={status === 'sending'}
          onClick={resend}
        >
          {status === 'sending' ? t('auth.resend.sending') : t('auth.resend.action')}
        </Button>
      )}
      {status === 'network' || status === 'error' ? (
        <p role="alert" className="text-sm text-destructive">
          {t(status === 'network' ? 'auth.errors.network' : 'auth.errors.unexpected')}
        </p>
      ) : null}
    </div>
  )
}
