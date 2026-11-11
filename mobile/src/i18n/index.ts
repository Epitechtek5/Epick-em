import { createInstance } from 'i18next';
import { initReactI18next } from 'react-i18next';
import { getLocales } from 'expo-localization';
import en from './locales/en.json';
import fr from './locales/fr.json';
import es from './locales/es.json';

export type Language = 'en' | 'fr' | 'es';
export function deviceLanguage(): Language {
  const language = getLocales()[0]?.languageCode;
  return language === 'fr' || language === 'es' ? language : 'en';
}

const i18n = createInstance();

void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    fr: { translation: fr },
    es: { translation: es },
  },
  lng: deviceLanguage(),
  fallbackLng: 'en',
  supportedLngs: ['en', 'fr', 'es'],
  initAsync: false,
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
});

export { useTranslation } from 'react-i18next';
export default i18n;
