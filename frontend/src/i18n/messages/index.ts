import type { Messages } from "./en";
import en from "./en";
import enExtra from "./extra/en";
import hiExtra from "./extra/hi";
import hi from "./hi";

export type { MessageKey } from "./en";

export const MESSAGES: Record<string, Messages> = {
  en: { ...en, ...enExtra },
  hi: { ...hi, ...hiExtra },
};

export type Vars = Record<string, string | number>;

/**
 * Look a message up in a language, filling {placeholders}. A language that lacks the message falls
 * back to English; an unknown key comes back as the key itself so a gap is visible, never blank.
 */
export function translate(lang: string, key: string, vars?: Vars): string {
  const text = MESSAGES[lang]?.[key] ?? MESSAGES.en[key] ?? key;
  return vars ? text.replace(/\{(\w+)\}/g, (whole, name: string) => (name in vars ? String(vars[name]) : whole)) : text;
}
