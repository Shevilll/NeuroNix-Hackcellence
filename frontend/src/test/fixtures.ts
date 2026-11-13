import type { TripPackage } from "../api/endpoints";
import type { TripOptions } from "../api/types";

/** What /api/options returns for the tests. */
export const tripOptions: TripOptions = {
  departure_cities: [
    { airport: "BLR", city: "Bengaluru" },
    { airport: "DEL", city: "Delhi" },
  ],
  countries: [
    { code: "JP", name: "Japan" },
    { code: "AE", name: "United Arab Emirates" },
  ],
  rules: {
    min_nights: 3,
    max_nights: 10,
    min_nights_per_city: 2,
    max_travelers: 9,
    data_window: { first_night: "2027-04-01", last_departure: "2027-04-20" },
  },
};

/** A short, valid-looking package in the shape the backend returns (3 nights, two cities). */
export function makePackage(overrides: Partial<TripPackage> = {}): TripPackage {
  return {
    trip_id: "pkg_test1",
    version: 1,
    start_date: "2027-04-10",
    end_date: "2027-04-14",
    budget_inr: 350000,
    total_inr: 231924,
    cities: ["Tokyo", "Kyoto"],
    nights_per_city: [2, 2],
    travel_minutes: 1150,
    avg_stars: 3.5,
    items: [
      { item_id: "i1", type: "flight", role: "arrival_flight", name: "AirVeda AV 520 BLR to NRT", city: "Tokyo",
        start: "2027-04-09T23:50", end: "2027-04-10T10:30", quantity: 3, price_inr: 75600, status: "PLANNED", catalog_id: "FL-401", warnings: [] },
      { item_id: "i2", type: "hotel", role: null, name: "Ginza Pearl Hotel", city: "Tokyo",
        start: "2027-04-10", end: "2027-04-12", quantity: 1, price_inr: 17360, status: "PLANNED", catalog_id: "HTL-TYO-001", warnings: [] },
      { item_id: "i3", type: "transfer", role: "arrival_transfer", name: "Narita limousine bus to Ginza", city: "Tokyo",
        start: "2027-04-10T11:30", end: "2027-04-10T13:10", quantity: 3, price_inr: 4480, status: "PLANNED", catalog_id: "TR-NRT-GNZ-BUS", warnings: [] },
      { item_id: "i4", type: "attraction", role: null, name: "Senso-ji", city: "Tokyo",
        start: "2027-04-11T09:00", end: "2027-04-11T10:00", quantity: 3, price_inr: 0, status: "PLANNED", catalog_id: "ATT-TYO-004", warnings: [] },
      { item_id: "i5", type: "hotel", role: null, name: "Sakura Garden Hotel", city: "Kyoto",
        start: "2027-04-12", end: "2027-04-14", quantity: 1, price_inr: 16240, status: "PLANNED", catalog_id: "HTL-KYO-004", warnings: [] },
      { item_id: "i6", type: "transfer", role: "intercity_transfer", name: "Shinkansen Tokyo to Kyoto", city: "Kyoto",
        start: "2027-04-12T10:00", end: "2027-04-12T12:15", quantity: 3, price_inr: 19838, status: "PLANNED", catalog_id: "TR-TYO-KYO-01", warnings: [] },
      { item_id: "i7", type: "attraction", role: null, name: "Fushimi Inari Taisha", city: "Kyoto",
        start: "2027-04-13T09:00", end: "2027-04-13T11:00", quantity: 3, price_inr: 0, status: "PLANNED", catalog_id: "ATT-KYO-002", warnings: [] },
      { item_id: "i8", type: "transfer", role: "departure_transfer", name: "Kansai limousine bus to Kyoto station", city: "Kyoto",
        start: "2027-04-14T08:00", end: "2027-04-14T09:00", quantity: 3, price_inr: 2240, status: "PLANNED", catalog_id: "TR-KIX-KYO-BUS", warnings: [] },
      { item_id: "i9", type: "flight", role: "return_flight", name: "AirVeda AV 515 KIX to BLR", city: "Bengaluru",
        start: "2027-04-14T12:00", end: "2027-04-14T18:00", quantity: 3, price_inr: 78120, status: "PLANNED", catalog_id: "FL-411", warnings: [] },
    ],
    ...overrides,
  };
}

/** A JSON Response for a stubbed fetch. */
export const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** A build answer with the recommended package and the three alternatives (G4). */
export function okBuild() {
  const alt = (id: string, extra: Partial<TripPackage>) => ({ package_id: id, package: makePackage({ trip_id: id, ...extra }) });
  return {
    status: "OK",
    package_id: "pkg_test1",
    package: makePackage(),
    alternatives: {
      cheapest: alt("pkg_cheap", { total_inr: 219324, cities: ["Tokyo"], nights_per_city: [4], travel_minutes: 1030, avg_stars: 3 }),
      fastest: alt("pkg_fast", { total_inr: 219324, cities: ["Tokyo"], nights_per_city: [4], travel_minutes: 1030, avg_stars: 3 }),
      best_rated: alt("pkg_stars", { total_inr: 316764, cities: ["Tokyo"], nights_per_city: [4], travel_minutes: 1030, avg_stars: 5 }),
    },
  };
}

const okCheck = {
  valid: true,
  violations: [],
  checklist: ["Dates and cities", "Flights", "Airport transfers", "Transfers between cities", "Hotels", "Attractions", "Prices"]
    .map((group) => ({ group, ok: true })),
};

/**
 * A fetch stub that answers the common endpoints. `extra` answers a URL first (it receives the
 * URL and the request init); return undefined to fall through to the defaults.
 */
export function stubApi(extra?: (url: string, init?: RequestInit) => Response | undefined | Promise<Response | undefined>) {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const custom = await extra?.(url, init);
    if (custom) return custom;
    if (url === "/api/options") return reply(200, tripOptions);
    if (url === "/api/check") return reply(200, okCheck);
    if (url === "/api/images") return reply(200, {});
    return reply(404, { detail: "not found" });
  };
}
