import type { TripItem, TripPackage } from "../api/endpoints";

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
const ICON: Record<TripItem["type"], string> = { flight: "✈️", hotel: "🏨", transfer: "🚕", attraction: "🎟️" };

function dayOf(item: TripItem) {
  return item.start.slice(0, 10);
}
function timeOf(item: TripItem) {
  return item.start.length > 10 ? item.start.slice(11, 16) : "check-in";
}

export default function PackageView({ pkg, budget }: { pkg: TripPackage; budget: number }) {
  const days = new Map<string, TripItem[]>();
  for (const item of [...pkg.items].sort((a, b) => a.start.localeCompare(b.start))) {
    const key = dayOf(item);
    days.set(key, [...(days.get(key) ?? []), item]);
  }
  const left = budget - pkg.total_inr;
  return (
    <section className="card" aria-label="Holiday package">
      <h2>
        {pkg.cities.map((c, i) => `${c} (${pkg.nights_per_city[i]}n)`).join(" → ")}
      </h2>
      <p>
        <strong>Total {inr(pkg.total_inr)}</strong> · Budget {inr(budget)} ·{" "}
        {left >= 0 ? `${inr(left)} left` : `${inr(-left)} over`}
      </p>
      {[...days.entries()].map(([day, items]) => (
        <div key={day} className="day">
          <h3>{new Date(day).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })}</h3>
          <ul>
            {items.map((i) => (
              <li key={i.item_id}>
                {ICON[i.type]} <b>{timeOf(i)}</b> {i.name} <span>({i.city})</span> — {inr(i.price_inr)}
                {i.status === "BOOKED" && " ✔ booked"}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
