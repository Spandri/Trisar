// Leichtgewichtiges i18n für die Demo (kein externes Paket): flache
// Key→Text-Wörterbücher pro Sprache, React-Context für die aktive Sprache,
// {name}-Interpolation. Referenzsprache ist Deutsch — fehlt ein Key in der
// aktiven Sprache, fällt t() auf Deutsch zurück, fehlt er auch dort, wird der
// rohe Key angezeigt (macht Lücken im Test sofort sichtbar).
//
// Die Sprache kommt aus dem Koordinator-Profil (Einstellungen → Sprache) und
// wird dort als Klarname gespeichert ('Deutsch', 'English', ...).

import { createContext, useContext, useMemo } from 'react';

import de from './de';
import en from './en';
import fr from './fr';
import it from './it';
import es from './es';
import tr from './tr';

const DICTS = { de, en, fr, it, es, tr };

export const LANGUAGE_TO_CODE = {
  Deutsch: 'de',
  English: 'en',
  'Français': 'fr',
  Italiano: 'it',
  'Español': 'es',
  'Türkçe': 'tr',
};

// Für Datums-/Zahlformate (toLocaleDateString etc.).
export const CODE_TO_LOCALE = {
  de: 'de-DE',
  en: 'en-GB',
  fr: 'fr-FR',
  it: 'it-IT',
  es: 'es-ES',
  tr: 'tr-TR',
};

const interpolate = (text, vars) => {
  if (!vars) return text;
  return String(text).replace(/\{(\w+)\}/g, (match, name) => (
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : match
  ));
};

// Auch außerhalb von React-Komponenten nutzbar (Modul-Helfer bekommen den
// Sprachcode durchgereicht).
export const translate = (code, key, vars) => {
  const dict = DICTS[code] || DICTS.de;
  const text = dict[key] ?? DICTS.de[key] ?? key;
  return interpolate(text, vars);
};

const I18nContext = createContext({
  t: (key, vars) => translate('de', key, vars),
  code: 'de',
  locale: 'de-DE',
  language: 'Deutsch',
});

export function I18nProvider({ language, children }) {
  const value = useMemo(() => {
    const code = LANGUAGE_TO_CODE[language] || 'de';
    return {
      t: (key, vars) => translate(code, key, vars),
      code,
      locale: CODE_TO_LOCALE[code] || 'de-DE',
      language: language || 'Deutsch',
    };
  }, [language]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export const useI18n = () => useContext(I18nContext);
