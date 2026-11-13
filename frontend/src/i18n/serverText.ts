/**
 * The backend writes its messages in English (why there is no package, budget fixes, change
 * refusals, rule violations, errors). This turns each known message into the traveler's language
 * by matching it against the English template of its key, so the patterns can never drift from
 * the wording. City names and dates inside a message are translated too. A message we do not know
 * is shown as it came: readable English, never a guess.
 */
import { localizeTerms } from "./format";
import { MESSAGES, translate } from "./messages";

/** Messages the backend sends word for word like the form's own checks. */
const SHARED = ["err.origin", "err.originList", "err.country", "err.countryList", "err.nights", "err.startDate",
  "err.dateFirst", "err.dateLast", "err.adults", "err.seats", "err.budget"];

interface Rule {
  key: string;
  re: RegExp;
}

function ruleFor(key: string): Rule {
  const english = MESSAGES.en[key];
  let source = "";
  let last = 0;
  for (const m of english.matchAll(/\{(\w+)\}/g)) {
    source += english.slice(last, m.index).replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + `(?<${m[1]}>[\\s\\S]+?)`;
    last = m.index! + m[0].length;
  }
  source += english.slice(last).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return { key, re: new RegExp(`^${source}$`) };
}

/** The more fixed words a template has, the more specific it is, so it is tried first. */
const literalLength = (key: string) => MESSAGES.en[key].replace(/\{\w+\}/g, "").length;

export const SERVER_KEYS = [...Object.keys(MESSAGES.en).filter((k) => /^[sv]\./.test(k)), ...SHARED];
const RULES: Rule[] = SERVER_KEYS.sort((a, b) => literalLength(b) - literalLength(a)).map(ruleFor);

export function translateServer(lang: string, text: string | null | undefined): string {
  if (!text || lang === "en") return text ?? "";
  for (const { key, re } of RULES) {
    const m = re.exec(text);
    if (!m) continue;
    const vars = Object.fromEntries(Object.entries(m.groups ?? {}).map(([k, v]) => [k, localizeTerms(lang, v)]));
    return translate(lang, key, vars);
  }
  return text;
}

/** A rule group name ("Flights", "Dates and cities") in the language. */
export const groupName = (lang: string, group: string) =>
  MESSAGES[lang]?.[`g.${group}`] ?? group;
