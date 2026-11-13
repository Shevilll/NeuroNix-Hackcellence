/** The languages the app can show. Each is named in its own script so a reader can find theirs. */
export interface Language {
  code: string;
  /** The language's own name. */
  name: string;
  /** BCP 47 locale for the browser's speech recognition and voices. */
  speech: string;
}

export const LANGUAGES: Language[] = [
  { code: "en", name: "English", speech: "en-IN" },
  { code: "hi", name: "हिन्दी", speech: "hi-IN" },
];

export const DEFAULT_LANGUAGE = "en";

export function languageByCode(code: string | null | undefined): Language {
  return LANGUAGES.find((l) => l.code === code) ?? LANGUAGES[0];
}

export const isSupported = (code: string | null | undefined): code is string => LANGUAGES.some((l) => l.code === code);

/** The locale to give the speech recogniser and the voices for a language. */
export const speechLocale = (code: string) => languageByCode(code).speech;
