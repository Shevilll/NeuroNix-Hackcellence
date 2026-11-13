import { useEffect, useMemo, useState, type ReactNode } from "react";
import { newIdempotencyKey } from "../api/client";
import { changePackage, checkTrip, type CheckReport, type TripItem, type TripPackage } from "../api/endpoints";
import { useI18n } from "../i18n/I18nProvider";
import { calendarFileName, tripCalendar } from "../lib/calendar";
import { messageFrom } from "../lib/errors";
import { eachDay, inr, nightsBetween, timeOf } from "../lib/format";
import BudgetBar from "./BudgetBar";
import ChangeOptions, { CityPlanOptions, type ChangeReport, type OptionKind } from "./ChangeOptions";
import CityRoute from "./CityRoute";
import Icon, { ItemIcon } from "./Icon";
import RouteMap from "./RouteMap";
import RuleChecklist from "./RuleChecklist";
import Spinner from "./Spinner";
import { usePhotos } from "./usePhotos";
import ZoomImage from "./ZoomImage";
import "./PackageView.css";

export interface EditOptions {
  /** Package id used for the change endpoints. */
  id: string;
  onChanged: (pkg: TripPackage) => void;
}

interface Props {
  pkg: TripPackage;
  budget: number;
  /** Turns on the change buttons (M6). Leave out for a read-only summary. */
  edit?: EditOptions;
  /** Buttons shown under the summary, e.g. Confirm. */
  actions?: ReactNode;
  /** Small heading above the route, e.g. "Your holiday" or "Cheapest package we found". */
  eyebrow?: string;
}

type Panel =
  | { kind: OptionKind; params: Record<string, string>; date?: string; title: string; day: string }
  | { kind: "cities"; day: "header" };

const ROLE_KEYS = new Set(["arrival_flight", "return_flight", "arrival_transfer", "departure_transfer", "intercity_transfer"]);

function kindLabel(item: TripItem, t: (key: string) => string) {
  return t(`item.${item.role && ROLE_KEYS.has(item.role) ? item.role : item.type}`);
}

/**
 * Sort key that puts every item in time order. A hotel has only a date, so its check-in is placed
 * right after the traveler reaches that city (airport or between-city transfer), else mid-afternoon.
 */
function sortKey(item: TripItem, items: TripItem[]): string {
  if (item.start.length > 10) return item.start;
  const arrival = items.find(
    (i) =>
      i.type === "transfer" &&
      (i.role === "arrival_transfer" || i.role === "intercity_transfer") &&
      i.city === item.city &&
      (i.end ?? i.start).slice(0, 10) === item.start,
  );
  return arrival?.end ?? `${item.start}T15:00`;
}

function travellers(pkg: TripPackage, count: (unit: string, n: number) => string) {
  const t = pkg.traveler;
  if (!t || t.adults === undefined) return null;
  const kids = t.children ?? t.child_ages?.length ?? 0;
  return [count("adult", t.adults), kids ? count("child", kids) : null].filter(Boolean).join(", ");
}

const TYPE_TOTALS: TripItem["type"][] = ["flight", "hotel", "transfer", "attraction"];

/** The whole package: a summary with the budget and rule checks, and the day-by-day plan (M4, M5). */
export default function PackageView({ pkg, budget, edit, actions, eyebrow }: Props) {
  const { t, ts, count, place, dayLabel, shortDate, dateRange, duration, signedInr } = useI18n();
  const [report, setReport] = useState<CheckReport | null>(null);
  const [checkFailed, setCheckFailed] = useState(false);
  const [panel, setPanel] = useState<Panel | null>(null);
  const [notice, setNotice] = useState<ChangeReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** The attraction being removed, while its request runs. */
  const [removing, setRemoving] = useState<string | null>(null);
  const photos = usePhotos();

  useEffect(() => {
    let live = true;
    setReport(null);
    setCheckFailed(false);
    checkTrip(pkg).then(
      (r) => live && setReport(r),
      () => live && setCheckFailed(true),
    );
    return () => {
      live = false;
    };
  }, [pkg]);

  // Switching to another package closes open panels and old messages.
  useEffect(() => {
    setPanel(null);
    setNotice(null);
    setError(null);
  }, [edit?.id]);

  const items = pkg.items ?? [];

  const days = useMemo(() => {
    const keyed = items.map((item) => ({ item, key: sortKey(item, items) }));
    keyed.sort((a, b) => a.key.localeCompare(b.key) || Number(b.item.type === "hotel") - Number(a.item.type === "hotel"));
    const dates = new Set(keyed.map((k) => k.key.slice(0, 10)));
    if (pkg.start_date && pkg.end_date) {
      for (const d of eachDay(pkg.start_date, pkg.end_date)) dates.add(d);
      dates.add(pkg.end_date);
    }
    const nightCity = new Map<string, string>();
    for (const h of items.filter((i) => i.type === "hotel" && i.end)) {
      for (const d of eachDay(h.start, h.end!)) nightCity.set(d, h.city);
    }
    return [...dates].sort().map((date) => ({
      date,
      items: keyed.filter((k) => k.key.slice(0, 10) === date).map((k) => k.item),
      city: nightCity.get(date),
      prevCity: nightCity.get(eachDayBefore(date)),
    }));
  }, [items, pkg.start_date, pkg.end_date]);

  function changed(next: TripPackage, r: ChangeReport) {
    edit?.onChanged(next);
    setNotice(r);
    setPanel(null);
  }

  async function remove(item: TripItem) {
    if (!edit) return;
    setRemoving(item.item_id);
    setError(null);
    try {
      const r = await changePackage(edit.id, { op: "remove_attraction", item_id: item.item_id, expected_version: pkg.version ?? 1 }, newIdempotencyKey());
      changed(r.package, { price_diff_inr: r.price_diff_inr ?? 0, warnings: r.warnings ?? [] });
    } catch (e) {
      setError(ts(messageFrom(e, t("c.refused"), t)));
    } finally {
      setRemoving(null);
    }
  }

  const toggle = (next: Panel) =>
    setPanel((p) => (p && p.kind === next.kind && p.day === next.day && JSON.stringify(p) === JSON.stringify(next) ? null : next));

  function panelFor(day: string) {
    if (!edit || !panel || panel.day !== day || panel.kind === "cities") return null;
    return (
      <ChangeOptions
        id={edit.id}
        pkg={pkg}
        kind={panel.kind}
        params={panel.params}
        date={panel.date}
        title={panel.title}
        onChanged={changed}
        onClose={() => setPanel(null)}
      />
    );
  }

  const calendarHref = useMemo(
    () => (items.length ? `data:text/calendar;charset=utf-8,${encodeURIComponent(tripCalendar(pkg))}` : null),
    [pkg, items.length],
  );
  const who = travellers(pkg, count);
  const nights = pkg.nights_per_city?.reduce((a, b) => a + b, 0) ?? 0;

  return (
    <section className="pkg" aria-label={t("pkg.aria")}>
      <header className="pkg__head card">
        <div className="pkg__title">
          <p className="eyebrow">
            {eyebrow ?? t("res.yours")}
            {pkg.country ? ` · ${place(pkg.country)}` : ""}
          </p>
          <h2>
            <CityRoute cities={pkg.cities ?? []} nights={pkg.nights_per_city ?? []} />
          </h2>
          <p className="pkg__facts">
            {pkg.start_date && pkg.end_date && (
              <span>
                <Icon name="calendar" /> {dateRange(pkg.start_date, pkg.end_date)}
              </span>
            )}
            {nights > 0 && (
              <span>
                <Icon name="moon" /> {count("night", nights)}
              </span>
            )}
            {who && (
              <span>
                <Icon name="users" /> {who}
              </span>
            )}
          </p>
        </div>
        {edit && (
          <button type="button" className="btn btn--secondary" aria-expanded={panel?.kind === "cities"} onClick={() => toggle({ kind: "cities", day: "header" })}>
            <Icon name="pin" /> {t("pkg.changeCities")}
          </button>
        )}
        {edit && panel?.kind === "cities" && (
          <div className="pkg__head-panel">
            <CityPlanOptions id={edit.id} pkg={pkg} onChanged={changed} onClose={() => setPanel(null)} />
          </div>
        )}
      </header>

      <RouteMap pkg={pkg} />

      <aside className="pkg__aside">
        <div className="card summary">
          <p className="summary__title">{t("res.total")}</p>
          <BudgetBar total={pkg.total_inr} budget={budget} />
          <dl className="summary__lines">
            {TYPE_TOTALS.map((type) => {
              const parts = items.filter((i) => i.type === type);
              if (!parts.length) return null;
              return (
                <div key={type}>
                  <dt>{t(`sect.${type}s`)}</dt>
                  <dd>{inr(parts.reduce((s, i) => s + i.price_inr, 0))}</dd>
                </div>
              );
            })}
          </dl>
          {(pkg.travel_minutes !== undefined || pkg.avg_stars !== undefined) && (
            <div className="summary__stats">
              {pkg.travel_minutes !== undefined && (
                <span>
                  <Icon name="clock" /> {t("pkg.inTransit", { time: duration(pkg.travel_minutes) })}
                </span>
              )}
              {pkg.avg_stars !== undefined && (
                <span>
                  <Icon name="star" /> {t("pkg.avgStars", { n: Number(pkg.avg_stars.toFixed(1)) })}
                </span>
              )}
            </div>
          )}
          {actions && <div className="summary__actions">{actions}</div>}
          {pkg.trip_id && (
            <a className="btn btn--ghost btn--block" href={`/api/packages/${pkg.trip_id}/export`} download>
              <Icon name="file" /> {t("pkg.export")}
            </a>
          )}
          {calendarHref && (
            <a className="btn btn--ghost btn--block" href={calendarHref} download={calendarFileName(pkg)} title={t("pkg.addToCalendarHint")}>
              <Icon name="calendar" /> {t("pkg.addToCalendar")}
            </a>
          )}
        </div>

        <div className="card rules">
          <p className="summary__title">
            <Icon name="shield" /> {t("pkg.rules")}
          </p>
          {report ? (
            <>
              <p className={report.valid ? "rules__verdict rules__verdict--ok" : "rules__verdict rules__verdict--bad"}>
                {report.valid ? t("pkg.allPass") : t("pkg.problemsFound", { problems: count("problem", report.violations.length) })}
              </p>
              <RuleChecklist report={report} />
            </>
          ) : (
            <p className="muted">{checkFailed ? t("pkg.checkUnavailable") : t("pkg.checking")}</p>
          )}
        </div>
      </aside>

      <div className="pkg__days">
        {notice && (
          <div role="status" className="change-notice">
            <Icon name="check" className="change-notice__icon" />
            <div>
              <p className="change-notice__title">{t("pkg.updated")}</p>
              <p className="change-notice__text">
                {notice.price_diff_inr === 0 ? t("pkg.sameTotal") : t("pkg.totalChanged", { amount: signedInr(notice.price_diff_inr) })}
              </p>
              {notice.warnings.map((w) => (
                <p key={w.code + w.message} className="change-notice__warn">
                  <Icon name="warning" /> {ts(w.message)}
                </p>
              ))}
            </div>
            <button type="button" className="icon-btn" aria-label={t("c.dismiss")} onClick={() => setNotice(null)}>
              <Icon name="cross" />
            </button>
          </div>
        )}
        {error && (
          <p role="alert" className="inline-error inline-error--box">
            <Icon name="warning" /> {error}
          </p>
        )}

        {days.map((day, n) => {
          const dayNumber = pkg.start_date ? nightsBetween(pkg.start_date, day.date) + 1 : n + 1;
          const headingId = `day-${pkg.trip_id ?? "pkg"}-${day.date}`;
          const isLast = day.date === pkg.end_date;
          const visits = day.items.filter((i) => i.type === "attraction").length;
          const fullDay = !!day.city && day.city === day.prevCity && day.date !== pkg.start_date;
          const tag =
            dayNumber < 1 ? t("pkg.leaveHome") : day.date === pkg.start_date ? t("pkg.arrival") : isLast ? t("pkg.flyHome") : day.city !== day.prevCity ? t("pkg.moveTo", { city: place(day.city ?? "") }) : null;
          const canAdd = !!edit && !!day.city && visits < 2;
          return (
            <section key={day.date} className="day" aria-labelledby={headingId}>
              <div className="day__head">
                <h3 id={headingId}>
                  <span className="day__num">{dayNumber < 1 ? t("pkg.before") : t("pkg.day", { n: dayNumber })}</span>{" "}
                  <span className="day__date">{dayLabel(day.date)}</span>
                </h3>
                <div className="day__tags">
                  {day.city && <span className="tag tag--city">{place(day.city)}</span>}
                  {tag && <span className="tag">{tag}</span>}
                </div>
              </div>

              {day.items.length > 0 && (
                <ul className="timeline">
                  {day.items.map((item) => {
                    const photo = photos[item.catalog_id ?? ""];
                    const start = timeOf(item.start);
                    const end = timeOf(item.end);
                    const endsOtherDay = item.end && item.end.slice(0, 10) !== item.start.slice(0, 10);
                    const hotelNights = item.type === "hotel" && item.end ? nightsBetween(item.start, item.end) : 0;
                    return (
                      <li key={item.item_id} className={`item item--${item.type}`}>
                        <div className="item__time">
                          {item.type === "hotel" ? (
                            <span className="item__checkin">{t("pkg.checkIn")}</span>
                          ) : (
                            <>
                              <span>{start}</span>
                              {end && <span className="item__end">{end}</span>}
                              {end && endsOtherDay && <span className="item__end">{shortDate(item.end!)}</span>}
                            </>
                          )}
                        </div>
                        <div className="item__media">
                          {photo ? <ZoomImage className="item__photo" src={photo} caption={item.name} /> : <span className="item__icon"><ItemIcon type={item.type} /></span>}
                        </div>
                        <div className="item__body">
                          <span className="item__kind">{kindLabel(item, t)}</span>
                          <span className="item__name">{item.name}</span>
                          <span className="item__sub">
                            {item.type === "hotel" && item.end
                              ? `${place(item.city)} · ${count("night", hotelNights)} · ${count("room", item.quantity)} · ${t("pkg.checkOut", { date: shortDate(item.end) })}`
                              : item.type === "flight"
                                ? `${count("seat", item.quantity)}${endsOtherDay ? ` · ${t("pkg.lands", { date: shortDate(item.end!), time: end ?? "" })}` : ""}`
                                : place(item.city)}
                          </span>
                          {item.warnings?.map((w) => (
                            <span key={w} className="item__warn">
                              <Icon name="warning" /> {ts(w)}
                            </span>
                          ))}
                        </div>
                        <div className="item__side">
                          <span className="item__price">{item.price_inr === 0 ? t("c.free") : inr(item.price_inr)}</span>
                          {edit && item.type === "hotel" && (
                            <button type="button" className="link-btn" aria-label={t("pkg.changeHotelIn", { city: place(item.city) })}
                              onClick={() => toggle({ kind: "hotels", params: { city: item.city }, title: t("pkg.otherHotels", { city: place(item.city) }), day: day.date })}>
                              <Icon name="edit" /> {t("c.change")}
                            </button>
                          )}
                          {edit && item.type === "flight" && (item.role === "arrival_flight" || item.role === "return_flight") && (
                            <button type="button" className="link-btn" aria-label={item.role === "arrival_flight" ? t("pkg.changeArrival") : t("pkg.changeReturn")}
                              onClick={() => toggle({ kind: "flights", params: { role: item.role! }, title: item.role === "arrival_flight" ? t("pkg.otherArrivals") : t("pkg.otherReturns"), day: day.date })}>
                              <Icon name="edit" /> {t("c.change")}
                            </button>
                          )}
                          {edit && item.type === "attraction" && (
                            <button type="button" className="link-btn link-btn--danger" aria-label={t("pkg.removeItem", { name: item.name })} disabled={removing !== null} onClick={() => remove(item)}>
                              {removing === item.item_id ? <Spinner decorative /> : <Icon name="trash" />}{" "}
                              {removing === item.item_id ? t("c.removing") : t("c.remove")}
                            </button>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}

              {fullDay && visits === 0 && <p className="day__empty">{t("pkg.noVisits")}</p>}

              {canAdd && (
                <button type="button" className="add-btn" aria-label={t("pkg.addAttractionOn", { date: dayLabel(day.date) })}
                  aria-expanded={panel?.kind === "attractions" && panel.day === day.date}
                  onClick={() => toggle({ kind: "attractions", params: {}, date: day.date, title: t("pkg.thingsToDo", { city: place(day.city ?? ""), date: dayLabel(day.date) }), day: day.date })}>
                  <Icon name="plus" /> {t("pkg.addAttraction")}
                </button>
              )}
              {panelFor(day.date)}
            </section>
          );
        })}
      </div>
    </section>
  );
}

function eachDayBefore(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}
