import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './en.json';
import tr from './tr.json';

function initialLanguage() {
  try {
    const saved = localStorage.getItem('language');
    if (saved) return saved;
  } catch {
    /* storage unavailable */
  }
  return (navigator.language || 'en').toLowerCase().startsWith('tr') ? 'tr' : 'en';
}

i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, tr: { translation: tr } },
  lng: initialLanguage(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});

export default i18n;
