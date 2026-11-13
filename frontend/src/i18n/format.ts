/**
 * Formatting in the traveler's language: dates, durations, counts, place names. English keeps the
 * exact output of lib/format.ts; other languages use the browser's own month and weekday names.
 */
import { dateRange as enDateRange, dayLabel as enDayLabel, duration as enDuration, shortDate as enShortDate, inr } from "../lib/format";
import { MESSAGES, translate } from "./messages";

const parts = (iso: string) => {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};

function intl(lang: string, iso: string, options: Intl.DateTimeFormatOptions): string | null {
  try {
    return new Intl.DateTimeFormat(`${lang}-IN`, { ...options, timeZone: "UTC" }).format(parts(iso));
  } catch {
    return null;
  }
}

/** "Sat 10 Apr" */
export const dayLabel = (lang: string, iso: string) =>
  lang === "en" ? enDayLabel(iso) : intl(lang, iso, { weekday: "short", day: "numeric", month: "short" }) ?? enDayLabel(iso);

/** "10 Apr" */
export const shortDate = (lang: string, iso: string) =>
  lang === "en" ? enShortDate(iso) : intl(lang, iso, { day: "numeric", month: "short" }) ?? enShortDate(iso);

/** "10 April 2027" */
export const longDate = (lang: string, iso: string) =>
  intl(lang === "en" ? "en" : lang, iso, { day: "numeric", month: "long", year: "numeric" }) ?? iso;

/** "10 – 16 Apr 2027" */
export function dateRange(lang: string, from: string, to: string): string {
  if (lang === "en") return enDateRange(from, to);
  const year = from.slice(0, 4);
  return `${shortDate(lang, from)} – ${shortDate(lang, to)} ${year}`;
}

/** "19 h 10 min" */
export function duration(lang: string, minutes: number): string {
  if (lang === "en") return enDuration(minutes);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return translate(lang, "u.min", { m });
  return m ? translate(lang, "u.hmin", { h, m }) : translate(lang, "u.h", { h });
}

/** "+₹1,568", "−₹2,360" or "Same price" */
export const signedInr = (lang: string, n: number) =>
  n === 0 ? translate(lang, "u.samePrice") : `${n > 0 ? "+" : "−"}${inr(Math.abs(n))}`;

/** "3 nights" / "1 night", in the language. `unit` is one of night, adult, child, room, seat, problem, booking. */
export const count = (lang: string, unit: string, n: number) => translate(lang, `u.${unit}.${n === 1 ? "one" : "other"}`, { n });

/** A city or country from the catalog in the language; anything unknown is left as it is. */
export function place(lang: string, name: string): string {
  const key = `p.${name}`;
  return MESSAGES[lang]?.[key] ?? MESSAGES.en[key] ?? name;
}

const PLACE_NAMES = Object.keys(MESSAGES.en)
  .filter((k) => k.startsWith("p."))
  .map((k) => k.slice(2))
  .sort((a, b) => b.length - a.length);
const PLACE_RE = new RegExp(`\\b(${PLACE_NAMES.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`, "g");
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const DATE_RE = /\b(\d{1,2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*(?: (\d{4}))?\b/g;

/** Inside a backend message part: put place names and "10 Apr 2027"-style dates in the language. */
export function localizeTerms(lang: string, text: string): string {
  if (lang === "en") return text;
  return text
    .replace(DATE_RE, (whole, d: string, mon: string, y?: string) => {
      const iso = `${y ?? "2027"}-${String(MONTHS.indexOf(mon.toLowerCase()) + 1).padStart(2, "0")}-${d.padStart(2, "0")}`;
      return (y ? longDate(lang, iso) : shortDate(lang, iso)) || whole;
    })
    .replace(PLACE_RE, (name) => place(lang, name));
}
