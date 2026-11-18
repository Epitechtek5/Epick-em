import {
  Delete02Icon,
  Image01Icon,
  LockPasswordIcon,
  Mail01Icon,
  UserCircleIcon,
  UserEdit01Icon,
} from '@hugeicons/core-free-icons'
import { useCallback, useEffect, useState } from 'react'

import {
  DeleteAccount,
  EmailForm,
  PasswordForm,
  PictureForm,
  UsernameForm,
} from '@/components/account/AccountForms'
import { PageHero, SectionCard } from '@/components/common/page-blocks'
import { StateMessage } from '@/components/games/StateMessage'
import { SettingsSections } from '@/components/settings/SettingsSections'
import { Button } from '@/components/ui/button'
import { UserAvatar } from '@/components/users/UserAvatar'
import { getMe, type SelfProfile } from '@/features/account/api'
import { useSettings } from '@/features/settings/context'
import { useDocumentTitle } from '@/hooks/use-document-title'
import { useI18n } from '@/i18n/context'
import { useAuth } from '@/lib/auth/auth-context'

type Load =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; profile: SelfProfile }

// Compte connecté (GET /me) : profil (nom d'utilisateur, photo), adresse e-mail, mot de passe,
// réglages (apparence, langue, notifications : GET/PATCH /me/settings) et suppression du
// compte. Seul le compte connecté voit son adresse. Un 401 est géré par le client API
// (renouvellement, sinon retour à la connexion).
export default function AccountPage() {
  const { t } = useI18n()
  const { username, role } = useAuth()
  const { setPictureUrl } = useSettings()
  useDocumentTitle(t('account.title'))
  const [load, setLoad] = useState<Load>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    getMe(controller.signal)
      .then((profile) => {
        setLoad({ status: 'ready', profile })
        setPictureUrl(profile.picture_url ?? null)
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return
        setLoad({ status: 'error' })
      })
    return () => controller.abort()
  }, [attempt, setPictureUrl])

  const retry = useCallback(() => {
    setLoad({ status: 'loading' })
    setAttempt((current) => current + 1)
  }, [])

  const onUpdated = useCallback(
    (profile: SelfProfile) => {
      setLoad({ status: 'ready', profile })
      setPictureUrl(profile.picture_url ?? null)
    },
    [setPictureUrl],
  )

  const profile = load.status === 'ready' ? load.profile : null
  const name = profile?.username ?? username ?? ''

  return (
    <div className="grid w-full max-w-6xl gap-6 self-start">
      <PageHero
        icon={UserCircleIcon}
        media={
          name ? (
            <UserAvatar
              src={profile?.picture_url}
              name={name}
              size="lg"
              decorative
              className="size-16 ring-2 ring-white/40 sm:size-20"
            />
          ) : undefined
        }
        title={t('account.title')}
        description={
          <div className="grid gap-1">
            {name ? (
              <p>
                <span className="font-semibold text-white">{name}</span>
                {role ? <span> · {t(`account.roles.${role}`)}</span> : null}
              </p>
            ) : null}
            <p>{t('account.description')}</p>
          </div>
        }
      />

      {load.status === 'loading' ? (
        <StateMessage kind="loading">{t('account.loading')}</StateMessage>
      ) : load.status === 'error' ? (
        <StateMessage
          kind="error"
          action={
            <Button variant="outline" size="sm" onClick={retry}>
              {t('common.retry')}
            </Button>
          }
        >
          {t('account.loadError')}
        </StateMessage>
      ) : null}

      {profile ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <SectionCard id="account-profile" icon={UserEdit01Icon} title={t('account.profile')} subtitle={t('account.profileHint')}>
            <UsernameForm profile={profile} onUpdated={onUpdated} />
          </SectionCard>
          <SectionCard
            id="account-picture-section"
            icon={Image01Icon}
            title={t('account.picture.title')}
            subtitle={t('account.picture.description')}
          >
            <PictureForm profile={profile} onUpdated={onUpdated} />
          </SectionCard>
          <SectionCard id="account-email-section" icon={Mail01Icon} title={t('account.changeTitle')} subtitle={t('account.privacy')}>
            <EmailForm profile={profile} onUpdated={onUpdated} />
          </SectionCard>
          <SectionCard
            id="account-password-section"
            icon={LockPasswordIcon}
            title={t('account.passwordForm.title')}
            subtitle={t('account.passwordForm.description')}
          >
            <PasswordForm profile={profile} />
          </SectionCard>
        </div>
      ) : null}

      <SettingsSections />

      {profile ? (
        <SectionCard
          id="account-delete-section"
          icon={Delete02Icon}
          title={t('account.deleteForm.title')}
          className="ring-destructive/40"
        >
          <DeleteAccount />
        </SectionCard>
      ) : null}
    </div>
  )
}
