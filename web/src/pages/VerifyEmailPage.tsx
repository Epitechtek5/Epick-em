import { useState } from 'react'
import { Link, useSearchParams } from 'react-router'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useDocumentTitle } from '@/hooks/use-document-title'
import { useNoReferrer } from '@/hooks/use-no-referrer'
import { useI18n } from '@/i18n/context'
import { verifyEmail } from '@/lib/api/auth'
import { ApiError } from '@/lib/api/client'

export default function VerifyEmailPage() {
  const { t } = useI18n()
  useDocumentTitle(t('auth.verify.title'))
  useNoReferrer()
  const [params] = useSearchParams()
  const values = params.getAll('token')
  const token = values.length === 1 ? values[0] : ''
  return <Confirmation key={token} token={token} />
}

type Status = 'ready' | 'sending' | 'success' | 'invalid' | 'retry'

// La confirmation n'est envoyée qu'au clic : un aperçu de lien (messagerie, antivirus)
// ne consomme pas le jeton à usage unique.
function Confirmation({ token }: { token: string }) {
  const { t } = useI18n()
  const [status, setStatus] = useState<Status>(token ? 'ready' : 'invalid')

  async function confirm() {
    setStatus('sending')
    try {
      await verifyEmail(token)
      setStatus('success')
    } catch (error) {
      setStatus(error instanceof ApiError && error.status === 400 ? 'invalid' : 'retry')
    }
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>
          {status === 'success' ? t('auth.verify.successTitle') : t('auth.verify.title')}
        </CardTitle>
        <CardDescription aria-live="polite">
          {status === 'success'
            ? t('auth.verify.success')
            : status === 'invalid'
              ? t('auth.verify.invalid')
              : t('auth.verify.intro')}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {status === 'success' || status === 'invalid' ? (
          <Button asChild>
            <Link to="/login">{t('auth.verify.goToLogin')}</Link>
          </Button>
        ) : (
          <>
            {status === 'retry' ? (
              <p role="alert" className="text-sm text-destructive">
                {t('auth.verify.retry')}
              </p>
            ) : null}
            <Button disabled={status === 'sending'} onClick={confirm}>
              {status === 'sending' ? t('auth.verify.confirming') : t('auth.verify.confirm')}
            </Button>
            {status !== 'sending' ? (
              <Button asChild variant="outline">
                <a href={`epickem://verify-email?token=${encodeURIComponent(token)}`}>
                  {t('auth.verify.openMobile')}
                </a>
              </Button>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  )
}
