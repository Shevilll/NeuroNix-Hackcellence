/** Small, dependency-free formatters shared by the package views. All dates are ISO strings. */

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Whole rupees with Indian grouping: 231924 -> "₹2,31,924". */
export const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

/** A price difference against the current choice: "+₹1,568", "−₹2,360" or "Same price". */
export const signedInr = (n: number) => (n === 0 ? "Same price" : `${n > 0 ? "+" : "−"}${inr(Math.abs(n))}`);

/** 1150 -> "19 h 10 min"; 120 -> "2 h". */
export function duration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return m ? `${h} h ${m} min` : `${h} h`;
}

function parts(iso: string) {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return { y, m, d, date: new Date(Date.UTC(y, m - 1, d)) };
}

/** "2027-04-10" -> "Sat 10 Apr". */
export function dayLabel(iso: string): string {
  const { d, m, date } = parts(iso);
  return `${WEEKDAYS[date.getUTCDay()]} ${d} ${MONTHS[m - 1]}`;
}

/** "2027-04-10" -> "10 Apr". */
export function shortDate(iso: string): string {
  const { d, m } = parts(iso);
  return `${d} ${MONTHS[m - 1]}`;
}

/** "2027-04-10" .. "2027-04-16" -> "10 – 16 Apr 2027" (or with both months when they differ). */
export function dateRange(fromIso: string, toIso: string): string {
  const a = parts(fromIso);
  const b = parts(toIso);
  if (a.y === b.y && a.m === b.m) return `${a.d} – ${b.d} ${MONTHS[a.m - 1]} ${a.y}`;
  return `${a.d} ${MONTHS[a.m - 1]} – ${b.d} ${MONTHS[b.m - 1]} ${b.y}`;
}

/** "2027-04-10T11:30" -> "11:30"; a date-only value has no time. */
export const timeOf = (iso: string | null | undefined) => (iso && iso.length > 10 ? iso.slice(11, 16) : null);

/** Days between two ISO dates (end exclusive): nights of a hotel stay. */
export function nightsBetween(fromIso: string, toIso: string): number {
  return Math.round((parts(toIso).date.getTime() - parts(fromIso).date.getTime()) / 86_400_000);
}

/** Every date from `fromIso` up to but not including `toIso`. */
export function eachDay(fromIso: string, toIso: string): string[] {
  const out: string[] = [];
  const cursor = parts(fromIso).date;
  const end = parts(toIso).date;
  while (cursor < end) {
    out.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
