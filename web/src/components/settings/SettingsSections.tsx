import {
  ComputerIcon,
  LanguageCircleIcon,
  Moon02Icon,
  Notification03Icon,
  PaintBoardIcon,
  Sun03Icon,
  Tick02Icon,
} from '@hugeicons/core-free-icons'
import { useId, useSyncExternalStore, type ReactNode } from 'react'

import { SectionCard } from '@/components/common/page-blocks'
import { StateMessage } from '@/components/games/StateMessage'
import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_CHANNELS,
  THEMES,
  type SettingsTheme,
} from '@/features/settings/api'
import { useSettings } from '@/features/settings/context'
import { LANGS, useI18n } from '@/i18n/context'
import { languageName } from '@/i18n/language-names'
import { themeStore } from '@/lib/theme/theme-store'
import { cn } from '@/lib/utils'

const THEME_ICONS: Record<SettingsTheme, typeof ComputerIcon> = {
  system: ComputerIcon,
  light: Sun03Icon,
  dark: Moon02Icon,
}

// Ligne d'un groupe de boutons radio natifs (clavier : flèches ; lecteurs d'écran : radio
// cochée/non cochée), présentée comme les listes de choix de l'application mobile.
function ChoiceRow({
  name,
  value,
  checked,
  icon,
  label,
  lang,
  onSelect,
}: {
  name: string
  value: string
  checked: boolean
  icon: typeof ComputerIcon
  label: string
  lang?: string
  onSelect: () => void
}) {
  return (
    <label
      className={cn(
        'flex min-h-12 cursor-pointer items-center gap-3 px-4 py-3 text-sm font-medium hover:bg-accent',
        'has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50 has-[:focus-visible]:ring-inset',
      )}
    >
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        onChange={onSelect}
        className="sr-only"
      />
      <Icon icon={icon} size={20} className={checked ? 'text-primary' : 'text-muted-foreground'} />
      <span className="flex-1" lang={lang}>
        {label}
      </span>
      {checked ? <Icon icon={Tick02Icon} size={20} /> : <span className="size-5" aria-hidden="true" />}
    </label>
  )
}

function ChoiceGroup({ legend, children }: { legend: string; children: ReactNode }) {
  return (
    <fieldset className="grid gap-3">
      <legend className="mb-3 text-sm font-medium">{legend}</legend>
      <div className="divide-y overflow-hidden rounded-xl ring-1 ring-foreground/10">{children}</div>
    </fieldset>
  )
}

// Apparence, langue et notifications du compte (GET/PATCH /me/settings via SettingsProvider),
// en deux sections au style des pages de tournois. Chaque choix s'applique immédiatement puis
// est enregistré sur le compte.
export function SettingsSections() {
  const { t, lang } = useI18n()
  const settings = useSettings()
  const theme = useSyncExternalStore(themeStore.subscribe, themeStore.get)
  const name = useId()

  return (
    <div className="grid gap-6">
      <div aria-live="polite" className="text-sm empty:hidden">
        {settings.saving ? <p className="text-muted-foreground">{t('settings.saving')}</p> : null}
      </div>
      {settings.saveError ? <StateMessage kind="error">{t(settings.saveError)}</StateMessage> : null}

      <SectionCard id="settings-display" icon={PaintBoardIcon} title={t('settings.title')} subtitle={t('settings.description')}>
        <div className="grid gap-6 md:grid-cols-2">
          <ChoiceGroup legend={t('settings.appearance')}>
            {THEMES.map((option) => (
              <ChoiceRow
                key={option}
                name={`${name}-theme`}
                value={option}
                checked={theme === option}
                icon={THEME_ICONS[option]}
                label={t(`settings.themes.${option}`)}
                onSelect={() => settings.setTheme(option)}
              />
            ))}
          </ChoiceGroup>

          <ChoiceGroup legend={t('settings.language')}>
            {LANGS.map((option) => (
              <ChoiceRow
                key={option}
                name={`${name}-language`}
                value={option}
                checked={lang === option}
                icon={LanguageCircleIcon}
                label={languageName(option)}
                lang={option}
                onSelect={() => settings.setLanguage(option)}
              />
            ))}
          </ChoiceGroup>
        </div>
      </SectionCard>

      <NotificationPreferences />
    </div>
  )
}

function NotificationPreferences() {
  const { t } = useI18n()
  const { status, notifications, setNotification, reload } = useSettings()

  return (
    <SectionCard
      id="settings-notifications"
      icon={Notification03Icon}
      title={t('settings.notifications')}
      subtitle={t('settings.notificationsHint')}
    >
      {status === 'loading' ? (
        <StateMessage kind="loading">{t('settings.loading')}</StateMessage>
      ) : status === 'error' ? (
        <StateMessage
          kind="error"
          action={
            <Button variant="outline" size="sm" onClick={reload}>
              {t('common.retry')}
            </Button>
          }
        >
          {t('settings.loadError')}
        </StateMessage>
      ) : (
        <div className="overflow-x-auto rounded-xl ring-1 ring-foreground/10">
          <table className="w-full text-sm">
            <caption className="sr-only">{t('settings.notifications')}</caption>
            <thead>
              <tr className="border-b text-left">
                <th scope="col" className="px-4 py-3 font-medium">
                  {t('settings.category')}
                </th>
                {NOTIFICATION_CHANNELS.map((channel) => (
                  <th key={channel} scope="col" className="w-24 px-4 py-3 text-center font-medium">
                    {t(`settings.channels.${channel}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {NOTIFICATION_CATEGORIES.map((category) => (
                <tr key={category}>
                  <th scope="row" className="px-4 py-3 text-left font-normal">
                    {t(`settings.categories.${category}`)}
                  </th>
                  {NOTIFICATION_CHANNELS.map((channel) => (
                    <td key={channel} className="px-4 py-3 text-center">
                      <input
                        type="checkbox"
                        role="switch"
                        className="size-4 cursor-pointer accent-primary"
                        aria-label={t('settings.toggle', {
                          category: t(`settings.categories.${category}`),
                          channel: t(`settings.channels.${channel}`),
                        })}
                        disabled={status !== 'ready'}
                        checked={notifications[category][channel]}
                        onChange={(event) => setNotification(category, channel, event.target.checked)}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </SectionCard>
  )
}
