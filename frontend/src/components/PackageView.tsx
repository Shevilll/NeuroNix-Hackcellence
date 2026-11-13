import { useEffect, useState } from "react";
import { checkTrip, type CheckReport, type TripItem, type TripPackage } from "../api/endpoints";
import CityRoute from "./CityRoute";
import Icon, { ItemIcon } from "./Icon";
import RuleChecklist from "./RuleChecklist";
import { usePhotos } from "./usePhotos";

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

function dayOf(item: TripItem) {
  return item.start.slice(0, 10);
}
function timeOf(item: TripItem) {
  return item.start.length > 10 ? item.start.slice(11, 16) : "check-in";
}

export default function PackageView({ pkg, budget }: { pkg: TripPackage; budget: number }) {
  const [report, setReport] = useState<CheckReport | null>(null);
  const photos = usePhotos();
  useEffect(() => {
    let live = true;
    setReport(null);
    checkTrip(pkg).then((r) => live && setReport(r), () => live && setReport(null));
    return () => { live = false; };
  }, [pkg]);
  const days = new Map<string, TripItem[]>();
  for (const item of [...pkg.items].sort((a, b) => a.start.localeCompare(b.start))) {
    const key = dayOf(item);
    days.set(key, [...(days.get(key) ?? []), item]);
  }
  const left = budget - pkg.total_inr;
  return (
    <section className="card" aria-label="Holiday package">
      <div className="package__head">
        <div>
          <h2><CityRoute cities={pkg.cities} nights={pkg.nights_per_city} /></h2>
          <p className="package__summary">
            <strong>{inr(pkg.total_inr)}</strong> of {inr(budget)} budget ·{" "}
            <span className={left >= 0 ? "left" : "over"}>
              {left >= 0 ? `${inr(left)} left` : `${inr(-left)} over`}
            </span>
          </p>
        </div>
        {pkg.trip_id && (
          <a className="btn" href={`/api/packages/${pkg.trip_id}/export`} download>
            Export JSON
          </a>
        )}
      </div>
      {report && <RuleChecklist report={report} />}
      {[...days.entries()].map(([day, items]) => (
        <div key={day} className="day">
          <h3>{new Date(day).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })}</h3>
          <ul>
            {items.map((i) => (
              <li key={i.item_id} className={photos[i.catalog_id ?? ""] ? "has-photo" : undefined}>
                {photos[i.catalog_id ?? ""] ? (
                  <img className="thumb" src={photos[i.catalog_id ?? ""]} alt={i.name} loading="lazy" />
                ) : (
                  <ItemIcon type={i.type} />
                )}
                <b>{timeOf(i)}</b>
                <span className="name">
                  {i.name} <span>({i.city})</span>
                  {i.status === "BOOKED" && (
                    <span className="booked"> <Icon name="check" /> booked</span>
                  )}
                </span>
                <span className="price">{inr(i.price_inr)}</span>
                {i.warnings?.map((w) => <span key={w} role="note" className="note"><Icon name="warning" /> {w}</span>)}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
