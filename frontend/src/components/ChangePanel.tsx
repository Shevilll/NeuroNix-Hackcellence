import { useState } from "react";
import { ApiError } from "../api/client";
import { changePackage, getCityPlans, getOptions2, type ChangeOption, type CityPlan, type TripPackage } from "../api/endpoints";
import CityRoute from "./CityRoute";

const diff = (n: number) => (n === 0 ? "same price" : `${n > 0 ? "+" : "−"}₹${Math.abs(n).toLocaleString("en-IN")}`);

type Kind = { label: string; kind: string; params: Record<string, string>; op: (o: ChangeOption) => Record<string, unknown> };

export default function ChangePanel({ id, pkg, onChanged }: { id: string; pkg: TripPackage; onChanged: (p: TripPackage) => void }) {
  const [open, setOpen] = useState<Kind | null>(null);
  const [options, setOptions] = useState<ChangeOption[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [plans, setPlans] = useState<CityPlan[] | null>(null);

  const kinds: Kind[] = [
    ...pkg.cities.map((city): Kind => ({
      label: `Change ${city} hotel`, kind: "hotels", params: { city },
      op: (o) => ({ op: "replace_hotel", city, hotel_id: o.hotel_id, room_id: o.room_id }),
    })),
    { label: "Change arrival flight", kind: "flights", params: { role: "arrival_flight" },
      op: (o) => ({ op: "replace_flight", role: "arrival_flight", flight_id: o.flight_id }) },
    { label: "Change return flight", kind: "flights", params: { role: "return_flight" },
      op: (o) => ({ op: "replace_flight", role: "return_flight", flight_id: o.flight_id }) },
    { label: "Add an attraction", kind: "attractions", params: {},
      op: (o) => ({ op: "add_attraction", attraction_id: o.attraction_id, date: o.date }) },
  ];

  async function show(k: Kind) {
    setOpen(k); setMessage(null); setOptions([]);
    try { setOptions(await getOptions2(id, k.kind, k.params)); } catch { setMessage("Could not load options."); }
  }

  async function showPlans() {
    setOpen(null); setMessage(null);
    try { setPlans(await getCityPlans(id)); } catch { setMessage("Could not load city plans."); }
  }

  async function run(change: Record<string, unknown>) {
    try {
      const r = await changePackage(id, { ...change, expected_version: pkg.version });
      onChanged(r.package); setOpen(null); setPlans(null); setMessage("Updated. The whole package was checked again.");
    } catch (e) {
      const d = e instanceof ApiError ? (e.body as { detail?: { message?: string } })?.detail : null;
      setMessage(d?.message ?? "That change was refused.");
    }
  }

  const removable = pkg.items.filter((i) => i.type === "attraction");
  return (
    <section className="card" aria-label="Change your package">
      <h3>Change your package</h3>
      <div className="change__buttons">{kinds.map((k) => <button key={k.label} type="button" className="btn" onClick={() => show(k)}>{k.label}</button>)}</div>
      <div className="change__buttons">
        <button type="button" className="btn" onClick={showPlans}>Change cities</button>
      </div>
      {message && <p role="status">{message}</p>}
      {plans && (
        <ul className="options">
          {plans.map((p, n) => (
            <li key={n}>
              <span>
                <CityRoute cities={p.cities} nights={p.nights_per_city} /> — ₹
                {p.total_inr.toLocaleString("en-IN")}
                {!p.within_budget && " · over budget"}
                {p.current && " · current"}
              </span>
              {!p.current && (
                <button type="button" className="btn"
                  onClick={() => run({ op: "change_cities", cities: p.cities, nights_per_city: p.nights_per_city })}>
                  Choose
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {open && (
        <ul className="options">
          {options.length === 0 && !message && <li>No other valid options.</li>}
          {options.map((o, n) => (
            <li key={n}>
              {o.name}{o.date ? ` · ${o.date}` : ""} — {diff(o.price_diff)}{" "}
              <button type="button" className="btn" onClick={() => run(open.op(o))}>Choose</button>
            </li>
          ))}
        </ul>
      )}
      <h4>Attractions</h4>
      <ul className="options options--plain">
        {removable.map((i) => (
          <li key={i.item_id}>
            {i.name} ({i.start.slice(0, 10)}){" "}
            <button type="button" className="btn" onClick={() => run({ op: "remove_attraction", item_id: i.item_id })}>Remove</button>
          </li>
        ))}
      </ul>
    </section>
  );
}
