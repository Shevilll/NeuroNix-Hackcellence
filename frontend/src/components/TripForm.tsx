import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import type { TripOptions, TripRequest } from "../api/types";
import {
  formatLongDate,
  toRequest,
  validateForm,
  type FormErrors,
  type FormValues,
} from "../domain/requestValidation";
import Spinner from "./Spinner";
import "./TripForm.css";

const EMPTY: FormValues = {
  origin: "",
  country: "",
  startDate: "",
  nights: "",
  adults: "",
  childAges: [],
  budget: "",
};

const MENON: FormValues = {
  origin: "BLR",
  country: "JP",
  startDate: "2027-04-10",
  nights: "6",
  adults: "2",
  childAges: ["6"],
  budget: "3,50,000",
};

interface Props {
  options: TripOptions;
  onSubmit: (request: TripRequest) => void;
  busy?: boolean;
  serverError?: string | null;
  /** Fields read from a quick request. A new object replaces what the form shows for those fields. */
  prefill?: Partial<TripRequest> | null;
}

type ErrorKey = keyof FormErrors;

export default function TripForm({ options, onSubmit, busy = false, serverError, prefill }: Props) {
  const [values, setValues] = useState<FormValues>(EMPTY);
  const [childCount, setChildCount] = useState("");
  const [errors, setErrors] = useState<FormErrors>({});

  const { rules } = options;

  useEffect(() => {
    if (!prefill) return;
    const country = options.countries.find((c) => c.name === prefill.country || c.code === prefill.country);
    const ages = prefill.children_ages;
    setValues((v) => ({
      ...v,
      ...(prefill.origin ? { origin: prefill.origin } : {}),
      ...(country ? { country: country.code } : {}),
      ...(prefill.start_date ? { startDate: prefill.start_date } : {}),
      ...(prefill.nights !== undefined ? { nights: String(prefill.nights) } : {}),
      ...(prefill.adults !== undefined ? { adults: String(prefill.adults) } : {}),
      ...(ages ? { childAges: ages.map(String) } : {}),
      ...(prefill.budget !== undefined ? { budget: Number(prefill.budget).toLocaleString("en-IN") } : {}),
    }));
    if (ages) setChildCount(ages.length ? String(ages.length) : "");
    setErrors({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill]);

  function update(patch: Partial<FormValues>, clear: ErrorKey) {
    setValues((v) => ({ ...v, ...patch }));
    setErrors((e) => ({ ...e, [clear]: undefined }));
  }

  function changeChildCount(text: string) {
    setChildCount(text);
    const n = /^\d+$/.test(text) ? Math.min(Number(text), rules.max_travelers) : 0;
    setValues((v) => ({
      ...v,
      childAges: Array.from({ length: n }, (_, i) => v.childAges[i] ?? ""),
    }));
    setErrors((e) => ({ ...e, childAges: undefined, adults: undefined }));
  }

  function loadExample() {
    setValues(MENON);
    setChildCount(String(MENON.childAges.length));
    setErrors({});
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const found = validateForm(values, options);
    setErrors(found);
    if (Object.keys(found).length === 0) onSubmit(toRequest(values));
  }

  const field = (key: ErrorKey) => ({
    "aria-invalid": errors[key] ? (true as const) : undefined,
    "aria-describedby": errors[key] ? `${key}-error` : undefined,
  });

  return (
    <form className="card trip-form" onSubmit={submit} noValidate>
      <div className="trip-form__head">
        <h2>Tell us about your trip</h2>
        <button type="button" className="btn btn--secondary" onClick={loadExample}>
          Load Menon example
        </button>
      </div>

      {serverError && (
        <p role="alert" className="trip-form__server-error">
          {serverError}
        </p>
      )}

      <fieldset className="trip-form__group">
        <legend>Where and when</legend>
        <div className="trip-form__grid trip-form__grid--two">
        <Field id="origin" label="Departure city" error={errors.origin}>
          <select
            id="origin"
            value={values.origin}
            onChange={(e) => update({ origin: e.target.value }, "origin")}
            {...field("origin")}
          >
            <option value="">Select a city</option>
            {options.departure_cities.map((c) => (
              <option key={c.airport} value={c.airport}>
                {c.city} ({c.airport})
              </option>
            ))}
          </select>
        </Field>

        <Field id="country" label="Destination country" error={errors.country}>
          <select
            id="country"
            value={values.country}
            onChange={(e) => update({ country: e.target.value }, "country")}
            {...field("country")}
          >
            <option value="">Select a country</option>
            {options.countries.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>

        <Field id="startDate" label="Start date" error={errors.startDate} hint={`Flights and rooms run ${formatLongDate(rules.data_window.first_night)} to ${formatLongDate(rules.data_window.last_departure)}.`}>
          <input
            id="startDate"
            type="date"
            min={rules.data_window.first_night}
            max={rules.data_window.last_departure}
            value={values.startDate}
            onChange={(e) => update({ startDate: e.target.value }, "startDate")}
            {...field("startDate")}
          />
        </Field>

        <Field id="nights" label="Nights" error={errors.nights} hint={`${rules.min_nights} to ${rules.max_nights} nights.`}>
          <input
            id="nights"
            type="number"
            inputMode="numeric"
            value={values.nights}
            onChange={(e) => update({ nights: e.target.value }, "nights")}
            {...field("nights")}
          />
        </Field>

        </div>
      </fieldset>

      <fieldset className="trip-form__group">
        <legend>Who is travelling</legend>
        <div className="trip-form__grid">
        <Field id="adults" label="Adults" error={errors.adults}>
          <input
            id="adults"
            type="number"
            inputMode="numeric"
            value={values.adults}
            onChange={(e) => update({ adults: e.target.value }, "adults")}
            {...field("adults")}
          />
        </Field>

        <Field id="children" label="Children">
          <input
            id="children"
            type="number"
            inputMode="numeric"
            min={0}
            value={childCount}
            onChange={(e) => changeChildCount(e.target.value)}
          />
        </Field>

        {values.childAges.map((age, i) => (
          <Field
            key={i}
            id={`child-age-${i}`}
            label={`Age of child ${i + 1}`}
            error={i === 0 ? errors.childAges : undefined}
            errorId="childAges-error"
          >
            <input
              id={`child-age-${i}`}
              type="number"
              inputMode="numeric"
              value={age}
              onChange={(e) =>
                update(
                  { childAges: values.childAges.map((a, j) => (j === i ? e.target.value : a)) },
                  "childAges",
                )
              }
              aria-invalid={errors.childAges ? true : undefined}
              aria-describedby={i === 0 && errors.childAges ? "childAges-error" : undefined}
            />
          </Field>
        ))}

        </div>
      </fieldset>

      <fieldset className="trip-form__group">
        <legend>Budget</legend>
        <div className="trip-form__grid">
        <Field id="budget" label="Budget for everything (INR)" error={errors.budget} hint="Flights, hotels, transfers and attractions all count.">
          <div className="money">
            <span className="money__sign" aria-hidden="true">₹</span>
            <input
              id="budget"
              type="text"
              inputMode="numeric"
              placeholder="3,50,000"
              value={values.budget}
              onChange={(e) => update({ budget: e.target.value }, "budget")}
              {...field("budget")}
            />
          </div>
        </Field>
        </div>
      </fieldset>

      <button type="submit" className="btn btn--primary trip-form__submit" disabled={busy}>
        {busy && <Spinner decorative />}
        {busy ? "Building your package…" : "Build my holiday"}
      </button>
    </form>
  );
}

function Field(props: {
  id: string;
  label: string;
  error?: string;
  errorId?: string;
  hint?: string;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={`field${props.wide ? " field--wide" : ""}${props.error ? " field--error" : ""}`}>
      <label htmlFor={props.id}>{props.label}</label>
      {props.children}
      {props.hint && !props.error && <p className="field__hint">{props.hint}</p>}
      {props.error && (
        <p className="field__error" id={props.errorId ?? `${props.id}-error`}>
          {props.error}
        </p>
      )}
    </div>
  );
}
