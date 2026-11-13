/**
 * Rough travel time between two visits from their latitude and longitude. The same formula as
 * backend/app/domain/geo.py, which spaces the visits when the traveller reorders a day.
 */

export interface Place {
  lat: number;
  lng: number;
}

const EARTH_RADIUS_KM = 6371;
const ROAD_FACTOR = 1.3; // streets are longer than the straight line
const CITY_SPEED_KMH = 25; // train, bus or taxi in a city, waits included
const START_MINUTES = 10; // walk to the station, buy a ticket
const STEP = 5;
const IST_OFFSET = 330; // UTC+5:30, minutes

const rad = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle (haversine) distance in km. */
export function distanceKm(a: Place, b: Place): number {
  const dp = rad(b.lat - a.lat);
  const dl = rad(b.lng - a.lng);
  const h = Math.sin(dp / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dl / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Minutes to get from one place to the next, rounded up to 5, never under 10. */
export function travelMinutes(km: number): number {
  const raw = START_MINUTES + ((km * ROAD_FACTOR) / CITY_SPEED_KMH) * 60;
  return Math.max(START_MINUTES, Math.ceil(raw / STEP - 1e-9) * STEP);
}

/** Times in a package are local to the destination; this is that zone. */
const ZONES: Record<string, { abbr: string; offset: number }> = {
  Japan: { abbr: "JST", offset: 540 },
  JP: { abbr: "JST", offset: 540 },
  "United Arab Emirates": { abbr: "GST", offset: 240 },
  AE: { abbr: "GST", offset: 240 },
};

export const localZone = (country: string | undefined) => ZONES[country ?? ""] ?? ZONES.Japan;

const clock = (minutes: number) => {
  const m = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};
const minutesOf = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** A local clock time ("10:00" at UTC+9 = offset 540) as the same moment in IST ("06:30"). */
export const toIst = (hhmm: string, offset: number) => clock(minutesOf(hhmm) - offset + IST_OFFSET);

export interface Leg {
  km: number;
  minutes: number;
  /** Local clock time the traveller leaves the first visit. */
  leave: string;
  /** Local clock time they reach the next one. */
  arrive: string;
  /** The next visit starts before they can get there. */
  tight: boolean;
}

/** The trip from the end of one visit (`fromEnd`) to the next visit (starting `nextStart`). */
export function legBetween(from: Place, to: Place, fromEnd: string, nextStart: string): Leg {
  const km = distanceKm(from, to);
  const minutes = travelMinutes(km);
  const leave = minutesOf(fromEnd.slice(11, 16));
  return {
    km: Math.round(km * 10) / 10,
    minutes,
    leave: clock(leave),
    arrive: clock(leave + minutes),
    tight: minutesOf(nextStart.slice(11, 16)) < leave + minutes,
  };
}

/**
 * Leaving the hotel to reach the day's first visit as it starts (`visitStart`). It is tight when that
 * means leaving before the traveller reaches the hotel that day (`reachHotel`, e.g. the airport bus).
 */
export function legFromHotel(hotel: Place, visit: Place, visitStart: string, reachHotel?: string): Leg {
  const km = distanceKm(hotel, visit);
  const minutes = travelMinutes(km);
  const arrive = minutesOf(visitStart.slice(11, 16));
  return {
    km: Math.round(km * 10) / 10,
    minutes,
    leave: clock(arrive - minutes),
    arrive: clock(arrive),
    tight: !!reachHotel && arrive - minutes < minutesOf(reachHotel.slice(11, 16)),
  };
}

/** Going back to the hotel when the day's last visit ends (`visitEnd`). */
export function legToHotel(visit: Place, hotel: Place, visitEnd: string): Leg {
  return { ...legBetween(visit, hotel, visitEnd, visitEnd), tight: false };
}

export const IST = IST_OFFSET;

/**
 * A local date and time ("2027-04-10T09:20", at UTC+9 = offset 540) as the same moment in India:
 * { date: "2027-04-10", time: "05:50" }. The date moves when the clock crosses midnight.
 * A bare date (a hotel night) has no time, so it gives null.
 */
export function istOf(iso: string, offset: number): { date: string; time: string } | null {
  if (iso.length <= 10) return null;
  const moment = new Date(`${iso.slice(0, 16)}:00Z`);
  moment.setUTCMinutes(moment.getUTCMinutes() - offset + IST_OFFSET);
  const text = moment.toISOString();
  return { date: text.slice(0, 10), time: text.slice(11, 16) };
}
