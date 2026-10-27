import { createInstance } from 'i18next';
import { initReactI18next } from 'react-i18next';
import { getLocales } from 'expo-localization';
import en from './locales/en.json';
import fr from './locales/fr.json';

export type Language = 'en' | 'fr';
export function deviceLanguage(): Language {
  return getLocales()[0]?.languageCode === 'fr' ? 'fr' : 'en';
}

const i18n = createInstance();

void i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, fr: { translation: fr } },
  lng: deviceLanguage(),
  fallbackLng: 'en',
  supportedLngs: ['en', 'fr'],
  initAsync: false,
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
});

export { useTranslation } from 'react-i18next';
export default i18n;
