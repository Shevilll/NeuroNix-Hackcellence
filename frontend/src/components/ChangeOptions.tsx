import { useEffect, useMemo, useState } from "react";
import { newIdempotencyKey } from "../api/client";
import {
  sendChange,
  getCityPlans,
  getOptions2,
  type ChangeOption,
  type ChangeTarget,
  type ChangeWarning,
  type CityPlan,
  type TripPackage,
} from "../api/endpoints";
import { messageFrom } from "../lib/errors";
import { inr } from "../lib/format";
import { IST, istOf, localZone } from "../lib/travel";
import CityRoute from "./CityRoute";
import { useI18n } from "../i18n/I18nProvider";
import Icon from "./Icon";
import Spinner from "./Spinner";

export interface ChangeReport {
  price_diff_inr: number;
  warnings: ChangeWarning[];
}

export type OptionKind = "hotels" | "flights" | "attractions";

interface Props {
  id: string;
  /** Set when the package is already booked: changes then go to the reservation. */
  reservation?: string;
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
async function apply(target: ChangeTarget, pkg: TripPackage, change: Record<string, unknown>) {
  const r = await sendChange(target, { ...change, expected_version: pkg.version ?? 1 }, newIdempotencyKey());
  return { pkg: r.package, report: { price_diff_inr: r.price_diff_inr ?? 0, warnings: r.warnings ?? [] } };
}

/**
 * G2: the valid alternatives for one part of the package, each with its price difference against
 * the current choice. Choosing one asks the backend to re-check the whole package (M6).
 */
/** A flight time in India time (IST). Flights from India leave in IST and land in destination time. */
function FlightTime({ label, iso, offset }: { label: string; iso: string; offset: number }) {
  const { t, shortDate } = useI18n();
  const at = istOf(iso, offset);
  return <span>{t(label, { date: shortDate(at?.date ?? iso), time: at?.time ?? "" })}</span>;
}

export default function ChangeOptions({ id, reservation, pkg, kind, params, date, title, onChanged, onClose }: Props) {
  const zone = localZone(pkg.country).offset;
  const { t, ts, count, signedInr } = useI18n();
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
      (e) => live && setLoadError(ts(messageFrom(e, t("opt.loadFail"), t))),
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
      const r = await apply({ id, reservation }, pkg, changeFor(kind, params, o));
      onChanged(r.pkg, r.report);
    } catch (e) {
      setError(ts(messageFrom(e, t("c.refused"), t)));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="change-panel" role="group" aria-label={title}>
      <div className="change-panel__head">
        <h4>{title}</h4>
        <button type="button" className="icon-btn" aria-label={t("c.close")} onClick={onClose}>
          <Icon name="cross" />
        </button>
      </div>
      <p className="change-panel__hint">
        {t("opt.hint")}
      </p>
      {error && (
        <p role="alert" className="inline-error">
          <Icon name="warning" /> {error}
        </p>
      )}
      {loadError && <p className="inline-error">{loadError}</p>}
      {!options && !loadError && <Spinner label={t("opt.finding")} showLabel />}
      {options && shown.length === 0 && <p className="muted">{t("opt.none")}</p>}
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
                      {t("pk.stars", { n: o.stars })}
                    </span>
                  )}
                  {o.area && <span>{o.area}</span>}
                  {o.rating !== undefined && <span>{t("opt.rating", { n: o.rating })}</span>}
                  {o.rooms !== undefined && <span>{count("room", o.rooms)}</span>}
                  {o.refundable !== undefined && <span>{o.refundable ? t("pkg.refundable") : t("pkg.nonRefundable")}</span>}
                  {o.depart && <FlightTime label="opt.departs" iso={o.depart} offset={params.role === "arrival_flight" ? IST : zone} />}
                  {o.arrive && <FlightTime label="opt.lands" iso={o.arrive} offset={params.role === "arrival_flight" ? zone : IST} />}
                </span>
              </div>
              <span className={diffClass(o.price_diff)}>{signedInr(o.price_diff)}</span>
              <button type="button" className="btn btn--secondary btn--sm" disabled={busy !== null} onClick={() => choose(o, i)}>
                {busy === i && <Spinner decorative />}
                {busy === i ? t("c.checking") : t("c.choose")}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export type PriceSort = "recommended" | "low" | "high";
export type PlacesSort = "any" | "most" | "fewest";

/**
 * Order city plans by the two dropdowns. The places order wins; the price order breaks ties
 * (cheapest first when no price order is picked). With neither set, the backend's order is kept.
 */
export function sortPlans(plans: CityPlan[], price: PriceSort, places: PlacesSort): CityPlan[] {
  if (price === "recommended" && places === "any") return plans;
  const byPlaces = (a: CityPlan, b: CityPlan) =>
    places === "most" ? b.cities.length - a.cities.length : places === "fewest" ? a.cities.length - b.cities.length : 0;
  const byPrice = (a: CityPlan, b: CityPlan) =>
    price === "high" ? b.total_inr - a.total_inr : price === "low" || places !== "any" ? a.total_inr - b.total_inr : 0;
  return [...plans].sort((a, b) => byPlaces(a, b) || byPrice(a, b));
}

/** G3: every valid city plan for the same request, with its total. Choosing one rebuilds the package. */
export function CityPlanOptions({ id, reservation, pkg, onChanged, onClose }: Omit<Props, "kind" | "params" | "date" | "title">) {
  const { t, ts, signedInr } = useI18n();
  const [plans, setPlans] = useState<CityPlan[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [priceSort, setPriceSort] = useState<PriceSort>("recommended");
  const [placesSort, setPlacesSort] = useState<PlacesSort>("any");
  const sorted = useMemo(() => sortPlans(plans ?? [], priceSort, placesSort), [plans, priceSort, placesSort]);

  useEffect(() => {
    let live = true;
    getCityPlans(id).then(
      (p) => live && setPlans(p),
      (e) => live && setError(ts(messageFrom(e, t("opt.plansFail"), t))),
    );
    return () => {
      live = false;
    };
  }, [id, pkg.version]);

  async function choose(plan: CityPlan, index: number) {
    setBusy(index);
    setError(null);
    try {
      const r = await apply({ id, reservation }, pkg, { op: "change_cities", cities: plan.cities, nights_per_city: plan.nights_per_city });
      onChanged(r.pkg, r.report);
    } catch (e) {
      setError(ts(messageFrom(e, t("opt.planFail"), t)));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="change-panel" role="group" aria-label={t("opt.chooseCities")}>
      <div className="change-panel__head">
        <h4>{t("opt.chooseCities")}</h4>
        <button type="button" className="icon-btn" aria-label={t("c.close")} onClick={onClose}>
          <Icon name="cross" />
        </button>
      </div>
      <p className="change-panel__hint">{t("opt.plansHint")}</p>
      {error && (
        <p role="alert" className="inline-error">
          <Icon name="warning" /> {error}
        </p>
      )}
      {!plans && !error && <Spinner label={t("opt.buildingPlans")} showLabel />}
      {plans && plans.length > 1 && (
        <div className="sort-bar">
          <label className="sort-field">
            <span className="sort-field__label">{t("opt.sortPrice")}</span>
            <span className="sort-field__control">
              <select value={priceSort} disabled={busy !== null} onChange={(e) => setPriceSort(e.target.value as PriceSort)}>
                <option value="recommended">{t("opt.sortRecommended")}</option>
                <option value="low">{t("opt.sortLow")}</option>
                <option value="high">{t("opt.sortHigh")}</option>
              </select>
              <Icon name="chevron" />
            </span>
          </label>
          <label className="sort-field">
            <span className="sort-field__label">{t("opt.sortPlaces")}</span>
            <span className="sort-field__control">
              <select value={placesSort} disabled={busy !== null} onChange={(e) => setPlacesSort(e.target.value as PlacesSort)}>
                <option value="any">{t("opt.sortAny")}</option>
                <option value="most">{t("opt.sortMost")}</option>
                <option value="fewest">{t("opt.sortFewest")}</option>
              </select>
              <Icon name="chevron" />
            </span>
          </label>
        </div>
      )}
      {plans && (
        <ul className="option-list">
          {sorted.map((p, i) => (
            <li key={`${p.cities.join("-")}-${p.nights_per_city.join("-")}`} className={`option${p.current ? " option--current" : ""}`}>
              <div className="option__main">
                <span className="option__name">
                  <CityRoute cities={p.cities} nights={p.nights_per_city} />
                </span>
                <span className="option__meta">
                  <span>{inr(p.total_inr)}</span>
                  {!p.within_budget && <span className="text-warn">{t("pk.over")}</span>}
                </span>
              </div>
              <span className={diffClass(p.total_inr - pkg.total_inr)}>{signedInr(p.total_inr - pkg.total_inr)}</span>
              {p.current ? (
                <span className="tag">{t("opt.current")}</span>
              ) : (
                <button type="button" className="btn btn--secondary btn--sm" disabled={busy !== null} onClick={() => choose(p, i)}>
                  {busy === i && <Spinner decorative />}
                  {busy === i ? t("c.building") : t("c.choose")}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
