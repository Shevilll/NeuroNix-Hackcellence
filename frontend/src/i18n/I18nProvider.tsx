import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import * as fmt from "./format";
import { DEFAULT_LANGUAGE, isSupported } from "./languages";
import { translate, type Vars } from "./messages";
import { groupName, translateServer } from "./serverText";

const STORAGE_KEY = "bmh.lang";

export interface I18n {
  /** The language the app is shown in. */
  lang: string;
  setLang: (code: string) => void;
  /** A message in the app's language. */
  t: (key: string, vars?: Vars) => string;
  /** A message in some other language, e.g. the one a quick request was typed in. */
  tIn: (lang: string, key: string, vars?: Vars) => string;
  /** A message written by the backend, in the app's language (unknown ones stay as they came). */
  ts: (text: string | null | undefined) => string;
  /** A rule group name from the backend ("Flights"). */
  group: (name: string) => string;
  /** "3 nights", "1 adult": unit is night, adult, child, room, seat, problem or booking. */
  count: (unit: string, n: number) => string;
  /** A catalog city or country name. */
  place: (name: string) => string;
  dayLabel: (iso: string) => string;
  shortDate: (iso: string) => string;
  longDate: (iso: string) => string;
  dateRange: (from: string, to: string) => string;
  duration: (minutes: number) => string;
  signedInr: (n: number) => string;
}

function make(lang: string, setLang: (code: string) => void): I18n {
  return {
    lang,
    setLang,
    t: (key, vars) => translate(lang, key, vars),
    tIn: translate,
    ts: (text) => translateServer(lang, text),
    group: (name) => groupName(lang, name),
    count: (unit, n) => fmt.count(lang, unit, n),
    place: (name) => fmt.place(lang, name),
    dayLabel: (iso) => fmt.dayLabel(lang, iso),
    shortDate: (iso) => fmt.shortDate(lang, iso),
    longDate: (iso) => fmt.longDate(lang, iso),
    dateRange: (from, to) => fmt.dateRange(lang, from, to),
    duration: (minutes) => fmt.duration(lang, minutes),
    signedInr: (n) => fmt.signedInr(lang, n),
  };
}

const Context = createContext<I18n>(make(DEFAULT_LANGUAGE, () => {}));

/** Components used on their own (tests) still work: with no provider they speak English. */
export const useI18n = () => useContext(Context);

function initialLanguage(): string {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (isSupported(saved)) return saved;
  } catch {
    /* storage can be blocked: start in English */
  }
  return DEFAULT_LANGUAGE;
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState(initialLanguage);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const setLang = useCallback((code: string) => {
    if (!isSupported(code)) return;
    setLangState(code);
    try {
      localStorage.setItem(STORAGE_KEY, code);
    } catch {
      /* the choice then lasts for this visit only */
    }
  }, []);

  const value = useMemo(() => make(lang, setLang), [lang, setLang]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
