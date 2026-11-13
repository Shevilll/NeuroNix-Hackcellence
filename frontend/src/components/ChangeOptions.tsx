import { useEffect, useMemo, useState } from "react";
import { newIdempotencyKey } from "../api/client";
import {
  changePackage,
  getCityPlans,
  getOptions2,
  type ChangeOption,
  type ChangeWarning,
  type CityPlan,
  type TripPackage,
} from "../api/endpoints";
import { messageFrom } from "../lib/errors";
import { inr, shortDate, signedInr, timeOf } from "../lib/format";
import CityRoute from "./CityRoute";
import Icon from "./Icon";

export interface ChangeReport {
  price_diff_inr: number;
  warnings: ChangeWarning[];
}

export type OptionKind = "hotels" | "flights" | "attractions";

interface Props {
  id: string;
  pkg: TripPackage;
  kind: OptionKind;
  /** Query for the options endpoint: `city` for hotels, `role` for flights. */
  params: Record<string, string>;
  /** For attractions: only show options for this day. */
  date?: string;
  title: string;
  onChanged: (pkg: TripPackage, report: ChangeReport) => void;
  onClose: () => void;
}

/** The change each kind of option makes. */
function changeFor(kind: OptionKind, params: Record<string, string>, o: ChangeOption): Record<string, unknown> {
  if (kind === "hotels") return { op: "replace_hotel", city: params.city, hotel_id: o.hotel_id, room_id: o.room_id };
  if (kind === "flights") return { op: "replace_flight", role: params.role, flight_id: o.flight_id };
  return { op: "add_attraction", attraction_id: o.attraction_id, date: o.date };
}

function diffClass(n: number) {
  return `diff ${n > 0 ? "diff--up" : n < 0 ? "diff--down" : "diff--same"}`;
}

/** Apply one change with its own idempotency key, so a retry of this click is never applied twice. */
async function apply(id: string, pkg: TripPackage, change: Record<string, unknown>) {
  const r = await changePackage(id, { ...change, expected_version: pkg.version ?? 1 }, newIdempotencyKey());
  return { pkg: r.package, report: { price_diff_inr: r.price_diff_inr ?? 0, warnings: r.warnings ?? [] } };
}

/**
 * G2: the valid alternatives for one part of the package, each with its price difference against
 * the current choice. Choosing one asks the backend to re-check the whole package (M6).
 */
export default function ChangeOptions({ id, pkg, kind, params, date, title, onChanged, onClose }: Props) {
  const [options, setOptions] = useState<ChangeOption[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const query = JSON.stringify(params);

  useEffect(() => {
    let live = true;
    setOptions(null);
    setLoadError(null);
    getOptions2(id, kind, params).then(
      (list) => live && setOptions(list),
      (e) => live && setLoadError(messageFrom(e, "Could not load the options.")),
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, kind, query, pkg.version]);

  const shown = useMemo(
    () => (options ?? []).filter((o) => !date || o.date === date),
    [options, date],
  );

  async function choose(o: ChangeOption, index: number) {
    setBusy(index);
    setError(null);
    try {
      const r = await apply(id, pkg, changeFor(kind, params, o));
      onChanged(r.pkg, r.report);
    } catch (e) {
      setError(messageFrom(e, "That change was refused."));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="change-panel" role="group" aria-label={title}>
      <div className="change-panel__head">
        <h4>{title}</h4>
        <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
          <Icon name="cross" />
        </button>
      </div>
      <p className="change-panel__hint">
        Every option below keeps all travel rules true. The price shows the difference to your current choice.
      </p>
      {error && (
        <p role="alert" className="inline-error">
          <Icon name="warning" /> {error}
        </p>
      )}
      {loadError && <p className="inline-error">{loadError}</p>}
      {!options && !loadError && <p className="muted">Finding options that keep every rule…</p>}
      {options && shown.length === 0 && <p className="muted">No other valid options for this part of the trip.</p>}
      {shown.length > 0 && (
        <ul className="option-list">
          {shown.map((o, i) => (
            <li key={`${o.hotel_id ?? o.flight_id ?? o.attraction_id}-${o.room_id ?? o.date ?? i}`} className="option">
              <div className="option__main">
                <span className="option__name">{o.name}</span>
                <span className="option__meta">
                  {o.stars !== undefined && (
                    <span className="option__stars">
                      <Icon name="star" />
                      {`${o.stars} stars`}
                    </span>
                  )}
                  {o.area && <span>{o.area}</span>}
                  {o.rating !== undefined && <span>{`Guest rating ${o.rating}`}</span>}
                  {o.rooms !== undefined && <span>{o.rooms === 1 ? "1 room" : `${o.rooms} rooms`}</span>}
                  {o.depart && <span>{`Departs ${shortDate(o.depart)} ${timeOf(o.depart) ?? ""}`}</span>}
                  {o.arrive && <span>{`Lands ${shortDate(o.arrive)} ${timeOf(o.arrive) ?? ""}`}</span>}
                </span>
              </div>
              <span className={diffClass(o.price_diff)}>{signedInr(o.price_diff)}</span>
              <button type="button" className="btn btn--secondary btn--sm" disabled={busy !== null} onClick={() => choose(o, i)}>
                {busy === i ? "Checking…" : "Choose"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** G3: every valid city plan for the same request, with its total. Choosing one rebuilds the package. */
export function CityPlanOptions({ id, pkg, onChanged, onClose }: Omit<Props, "kind" | "params" | "date" | "title">) {
  const [plans, setPlans] = useState<CityPlan[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);

  useEffect(() => {
    let live = true;
    getCityPlans(id).then(
      (p) => live && setPlans(p),
      (e) => live && setError(messageFrom(e, "Could not load the city plans.")),
    );
    return () => {
      live = false;
    };
  }, [id, pkg.version]);

  async function choose(plan: CityPlan, index: number) {
    setBusy(index);
    setError(null);
    try {
      const r = await apply(id, pkg, { op: "change_cities", cities: plan.cities, nights_per_city: plan.nights_per_city });
      onChanged(r.pkg, r.report);
    } catch (e) {
      setError(messageFrom(e, "That city plan could not be built."));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="change-panel" role="group" aria-label="Choose other cities">
      <div className="change-panel__head">
        <h4>Choose other cities</h4>
        <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
          <Icon name="cross" />
        </button>
      </div>
      <p className="change-panel__hint">Every plan below was built with real flights, rooms and transfers for your dates.</p>
      {error && (
        <p role="alert" className="inline-error">
          <Icon name="warning" /> {error}
        </p>
      )}
      {!plans && !error && <p className="muted">Building every city plan…</p>}
      {plans && (
        <ul className="option-list">
          {plans.map((p, i) => (
            <li key={`${p.cities.join("-")}-${p.nights_per_city.join("-")}`} className={`option${p.current ? " option--current" : ""}`}>
              <div className="option__main">
                <span className="option__name">
                  <CityRoute cities={p.cities} nights={p.nights_per_city} />
                </span>
                <span className="option__meta">
                  <span>{inr(p.total_inr)}</span>
                  {!p.within_budget && <span className="text-warn">Over budget</span>}
                </span>
              </div>
              <span className={diffClass(p.total_inr - pkg.total_inr)}>{signedInr(p.total_inr - pkg.total_inr)}</span>
              {p.current ? (
                <span className="tag">Current plan</span>
              ) : (
                <button type="button" className="btn btn--secondary btn--sm" disabled={busy !== null} onClick={() => choose(p, i)}>
                  {busy === i ? "Building…" : "Choose"}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
