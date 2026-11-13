/**
 * The whole trip as an ordered list of places for the route map: home airport, flight, hotel, each
 * day's visits, the next city, the flight home. Built only from the package and GET /api/map-points.
 */
import type { TripItem, TripPackage } from "../api/endpoints";

export interface MapPlace {
  lat: number;
  lng: number;
  name: string;
}

/** What GET /api/map-points returns. */
export interface MapPoints {
  airports: Record<string, MapPlace>;
  hotels: Record<string, MapPlace>;
  attractions: Record<string, MapPlace>;
  flights: Record<string, { from: string; to: string }>;
}

export type StopKind = "airport" | "hotel" | "attraction";

export interface Stop extends MapPlace {
  /** "airport:BLR", "hotel:HTL-TYO-001", "attraction:ATT-KYO-002": the same place has the same key. */
  key: string;
  kind: StopKind;
  /** Visits are numbered 1, 2, 3 ... in the order they happen; other stops have none. */
  visit?: number;
}

export interface RouteLeg {
  from: Stop;
  to: Stop;
  mode: "flight" | "ground";
}

export interface RouteDay {
  date: string;
  stops: Stop[];
  legs: RouteLeg[];
}

export interface Route {
  stops: Stop[];
  legs: RouteLeg[];
  days: RouteDay[];
}

interface Step {
  stop: Stop;
  /** How the traveller got here from the step before. */
  mode: "flight" | "ground";
}

const dateOf = (iso: string) => iso.slice(0, 10);

function place(kind: StopKind, id: string | undefined, points: MapPoints): Stop | null {
  if (!id) return null;
  const table = kind === "airport" ? points.airports : kind === "hotel" ? points.hotels : points.attractions;
  const found = table[id];
  return found ? { key: `${kind}:${id}`, kind, lat: found.lat, lng: found.lng, name: found.name } : null;
}

/** Joins steps into stops and legs, dropping a step that stays at the same place. */
function chain(steps: Step[]): { stops: Stop[]; legs: RouteLeg[] } {
  const stops: Stop[] = [];
  const legs: RouteLeg[] = [];
  for (const { stop, mode } of steps) {
    const last = stops[stops.length - 1];
    if (last?.key === stop.key) continue;
    if (last) legs.push({ from: last, to: stop, mode });
    stops.push(stop);
  }
  return { stops, legs };
}

export function buildRoute(pkg: TripPackage, points: MapPoints): Route {
  const items = [...pkg.items].sort((a, b) => a.start.localeCompare(b.start));
  const hotels = items.filter((i) => i.type === "hotel");
  /** The hotel the traveller sleeps in on the night of `date`. */
  const hotelFor = (date: string) => {
    const stay = hotels.find((h) => dateOf(h.start) <= date && date < dateOf(h.end ?? h.start));
    return place("hotel", stay?.catalog_id, points);
  };

  const byDay = new Map<string, TripItem[]>();
  for (const item of items) {
    if (item.type === "hotel") continue;
    const date = dateOf(item.start);
    byDay.set(date, [...(byDay.get(date) ?? []), item]);
  }

  let visits = 0;
  const visitNumbers = new Map<string, number>();
  let here: Stop | null = null;
  const days: RouteDay[] = [];
  const all: Step[] = [];

  for (const date of [...byDay.keys()].sort()) {
    const steps: Step[] = here ? [{ stop: here, mode: "ground" }] : [];
    for (const item of byDay.get(date) ?? []) {
      if (item.type === "flight") {
        const flight = points.flights[item.catalog_id ?? ""];
        const from = place("airport", flight?.from, points);
        const to = place("airport", flight?.to, points);
        if (from) steps.push({ stop: from, mode: "ground" });
        if (to) steps.push({ stop: to, mode: "flight" });
      } else if (item.type === "transfer") {
        // Into town from the airport, or on to the next city: either way it ends at tonight's hotel.
        const role = item.role ?? "";
        if (role === "arrival_transfer" || role === "intercity_transfer") {
          const hotel = hotelFor(date);
          if (hotel) steps.push({ stop: hotel, mode: "ground" });
        }
      } else if (item.type === "attraction") {
        const visit = place("attraction", item.catalog_id, points);
        if (visit) {
          const number = visitNumbers.get(item.item_id) ?? ++visits;
          visitNumbers.set(item.item_id, number);
          steps.push({ stop: { ...visit, visit: number }, mode: "ground" });
        }
      }
    }
    const tonight = hotelFor(date);
    if (tonight) steps.push({ stop: tonight, mode: "ground" });

    const day = chain(steps);
    if (day.stops.length) {
      days.push({ date, ...day });
      here = day.stops[day.stops.length - 1];
    }
    all.push(...steps);
  }

  return { ...chain(all), days };
}
