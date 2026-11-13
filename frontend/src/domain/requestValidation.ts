import type { TripOptions, TripRequest } from "../api/types";

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

export function formatLongDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
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

export function validateForm(v: FormValues, options: TripOptions): FormErrors {
  const errors: FormErrors = {};
  const { rules } = options;

  if (!v.origin) errors.origin = "Choose a departure city.";
  else if (!options.departure_cities.some((c) => c.airport === v.origin))
    errors.origin = "Choose a departure city from the list.";

  if (!v.country) errors.country = "Choose a destination country.";
  else if (!options.countries.some((c) => c.code === v.country))
    errors.country = "Choose a destination country from the list.";

  const nights = isWholeNumber(v.nights) ? Number(v.nights) : NaN;
  if (!v.nights.trim() || !(nights >= rules.min_nights && nights <= rules.max_nights))
    errors.nights = `Nights must be a whole number between ${rules.min_nights} and ${rules.max_nights}.`;

  const start = parseIso(v.startDate);
  if (!v.startDate) errors.startDate = "Choose the holiday start date.";
  else if (!start) errors.startDate = "Enter a valid date.";
  else {
    const first = parseIso(rules.data_window.first_night)!;
    const last = parseIso(rules.data_window.last_departure)!;
    if (start < first)
      errors.startDate = `The first night must be on or after ${formatLongDate(rules.data_window.first_night)}.`;
    else if (!Number.isNaN(nights) && !errors.nights) {
      const end = new Date(start.getTime() + nights * 86_400_000);
      if (end > last)
        errors.startDate = `The return flight must be on or before ${formatLongDate(rules.data_window.last_departure)}. Start earlier or choose fewer nights.`;
    }
  }

  const adults = isWholeNumber(v.adults) ? Number(v.adults) : NaN;
  if (!(adults >= 1)) errors.adults = "At least 1 adult is required.";

  const agesBad = v.childAges.some((a) => !a.trim());
  const ages = v.childAges.map((a) => (isWholeNumber(a) ? Number(a) : NaN));
  if (agesBad) errors.childAges = "Enter the age of every child.";
  else if (ages.some((a) => !(a >= 0 && a <= 17))) errors.childAges = "Child ages must be whole numbers between 0 and 17.";

  if (!errors.adults && !errors.childAges && adults + ages.length > rules.max_travelers)
    errors.adults = `No flight has seats for more than ${rules.max_travelers} travelers.`;

  const budget = parseBudget(v.budget);
  if (!(budget > 0) || !Number.isFinite(budget)) errors.budget = "Enter a budget greater than 0 (in INR).";

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
