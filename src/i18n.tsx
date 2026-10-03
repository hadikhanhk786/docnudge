import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import enDict from './locales/en.json';
import arDict from './locales/ar.json';

export type Lang = 'en' | 'ar';
export type Key = keyof typeof enDict;

// Compile-time check: the Arabic file must define every English key.
const en: Record<Key, string> = enDict;
const ar: Record<Key, string> = arDict;
const dicts: Record<Lang, Record<Key, string>> = { en, ar };

interface I18n {
  lang: Lang;
  dir: 'ltr' | 'rtl';
  setLang: (l: Lang) => void;
  t: (key: Key, vars?: Record<string, string | number>) => string;
}

const Ctx = createContext<I18n | null>(null);

export function I18nProvider({ children, initial, persist = true }: { children: ReactNode; initial?: Lang; persist?: boolean }) {
  const [lang, setLangState] = useState<Lang>(() => {
    if (initial) return initial;
    try {
      return localStorage.getItem('docchase.lang') === 'ar' ? 'ar' : 'en';
    } catch {
      return 'en';
    }
  });

  const setLang = useCallback(
    (l: Lang) => {
      setLangState(l);
      if (persist) {
        try {
          localStorage.setItem('docchase.lang', l);
        } catch {
          /* storage can be unavailable (private mode); the choice just won't persist */
        }
      }
    },
    [persist],
  );

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
  }, [lang]);

  const value = useMemo<I18n>(
    () => ({
      lang,
      dir: lang === 'ar' ? 'rtl' : 'ltr',
      setLang,
      t: (key, vars) => {
        let s = dicts[lang][key] ?? dicts.en[key] ?? key;
        if (vars) for (const [name, v] of Object.entries(vars)) s = s.replaceAll(`{${name}}`, String(v));
        return s;
      },
    }),
    [lang, setLang],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n(): I18n {
  const v = useContext(Ctx);
  if (!v) throw new Error('useI18n must be used inside <I18nProvider>');
  return v;
}
