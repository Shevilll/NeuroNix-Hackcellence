import type { TripOptions, TripRequest } from "../api/types";
import { translate } from "../i18n/messages";

/** Raw text values straight from the form inputs. */
export interface FormValues {
  origin: string;
  country: string;
  startDate: string;
  nights: string;
  adults: string;
  childAges: string[];
  budget: string;
}

export type FormErrors = Partial<Record<"origin" | "country" | "startDate" | "nights" | "adults" | "childAges" | "budget", string>>;

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "2027-04-01" -> "1 April 2027"; in another language the browser writes the month name for it. */
export function formatLongDate(iso: string, lang = "en"): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (lang !== "en") {
    try {
      return new Intl.DateTimeFormat(`${lang}-IN`, { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d)));
    } catch {
      /* an unsupported locale: use the English form below */
    }
  }
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

const isWholeNumber = (s: string) => /^-?\d+$/.test(s.trim());

/** Parse an ISO date (YYYY-MM-DD) as a UTC date, or null when it is not a real calendar date. */
function parseIso(s: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const date = new Date(`${s}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== s ? null : date;
}

/** "3,50,000" or "350000" -> 350000, or NaN. */
export function parseBudget(s: string): number {
  const cleaned = s.replace(/[,\s₹]/g, "");
  return /^\d+(\.\d+)?$/.test(cleaned) ? Number(cleaned) : NaN;
}

/** Says a message in the traveler's language. The default is English, so callers that pass nothing are unchanged. */
export type Say = (key: string, vars?: Record<string, string | number>) => string;

export function validateForm(v: FormValues, options: TripOptions, t: Say = (key, vars) => translate("en", key, vars), lang = "en"): FormErrors {
  const errors: FormErrors = {};
  const { rules } = options;

  if (!v.origin) errors.origin = t("err.origin");
  else if (!options.departure_cities.some((c) => c.airport === v.origin))
    errors.origin = t("err.originList");

  if (!v.country) errors.country = t("err.country");
  else if (!options.countries.some((c) => c.code === v.country))
    errors.country = t("err.countryList");

  const nights = isWholeNumber(v.nights) ? Number(v.nights) : NaN;
  if (!v.nights.trim() || !(nights >= rules.min_nights && nights <= rules.max_nights))
    errors.nights = t("err.nights", { min: rules.min_nights, max: rules.max_nights });

  const start = parseIso(v.startDate);
  if (!v.startDate) errors.startDate = t("err.startDate");
  else if (!start) errors.startDate = t("err.dateInvalid");
  else {
    const first = parseIso(rules.data_window.first_night)!;
    const last = parseIso(rules.data_window.last_departure)!;
    if (start < first)
      errors.startDate = t("err.dateFirst", { date: formatLongDate(rules.data_window.first_night, lang) });
    else if (!Number.isNaN(nights) && !errors.nights) {
      const end = new Date(start.getTime() + nights * 86_400_000);
      if (end > last)
        errors.startDate = t("err.dateLast", { date: formatLongDate(rules.data_window.last_departure, lang) });
    }
  }

  const adults = isWholeNumber(v.adults) ? Number(v.adults) : NaN;
  if (!(adults >= 1)) errors.adults = t("err.adults");

  const agesBad = v.childAges.some((a) => !a.trim());
  const ages = v.childAges.map((a) => (isWholeNumber(a) ? Number(a) : NaN));
  if (agesBad) errors.childAges = t("err.agesAll");
  else if (ages.some((a) => !(a >= 0 && a <= 17))) errors.childAges = t("err.agesRange");

  if (!errors.adults && !errors.childAges && adults + ages.length > rules.max_travelers)
    errors.adults = t("err.seats", { max: rules.max_travelers });

  const budget = parseBudget(v.budget);
  if (!(budget > 0) || !Number.isFinite(budget)) errors.budget = t("err.budget");

  return errors;
}

/** Only call with values that passed validateForm. */
export function toRequest(v: FormValues): TripRequest {
  return {
    origin: v.origin,
    country: v.country,
    start_date: v.startDate,
    nights: Number(v.nights),
    adults: Number(v.adults),
    children_ages: v.childAges.map(Number),
    budget: parseBudget(v.budget),
  };
}
