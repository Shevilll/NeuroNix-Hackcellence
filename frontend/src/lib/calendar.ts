/**
 * The whole holiday plan as an iCalendar (.ics, RFC 5545) file, so the traveller can add every
 * flight, transfer, hotel stay and visit to Google Calendar, Apple Calendar or Outlook in one go.
 *
 * Times go out in UTC, so each calendar shows them in the traveller's own zone. Every event has a
 * stable UID (item id + trip id): importing the file again after a change updates the events
 * instead of adding a second copy.
 */
import type { TripItem, TripPackage } from "../api/endpoints";

const DOMAIN = "build-my-holiday";
const IST = 330; // UTC+5:30, minutes

/** UTC offset (minutes) of the destination; package times are local to it. Japan by default. */
const ZONE_OFFSETS: Record<string, number> = { Japan: 540, JP: 540, "United Arab Emirates": 240, AE: 240 };
const localOffset = (country: string | undefined) => ZONE_OFFSETS[country ?? ""] ?? ZONE_OFFSETS.Japan;
const ONE_HOUR = 60;

/** UTC offset (minutes) a time of `item` is written in; see offsetOf in PackageView. */
function offsetOf(item: TripItem, end: "start" | "end", local: number): number {
  if (item.role === "arrival_flight") return end === "start" ? IST : local;
  if (item.role === "return_flight") return end === "start" ? local : IST;
  return local;
}

/** "2027-04-10T11:30" at UTC+9 (offset 540) as "20270410T023000Z". */
function utcStamp(iso: string, offset: number, plusMinutes = 0): string {
  const moment = new Date(`${iso.slice(0, 16)}:00Z`);
  moment.setUTCMinutes(moment.getUTCMinutes() - offset + plusMinutes);
  return stamp(moment);
}

const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

const dateOnly = (iso: string) => iso.slice(0, 10).replace(/-/g, "");

function dayAfter(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Escape a TEXT value (RFC 5545 §3.3.11). */
const text = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

/** Fold a content line at 75 octets, never inside a UTF-8 character (RFC 5545 §3.1). */
function fold(line: string): string {
  const enc = new TextEncoder();
  const parts: string[] = [];
  let cur = "";
  let size = 0;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    const limit = parts.length ? 74 : 75; // continuation lines start with a space
    if (size + n > limit) {
      parts.push(cur);
      cur = "";
      size = 0;
    }
    cur += ch;
    size += n;
  }
  parts.push(cur);
  return parts.join("\r\n ");
}

const PREFIX: Partial<Record<TripItem["type"], string>> = { flight: "Flight: ", hotel: "Hotel: " };

function itemEvent(item: TripItem, pkg: TripPackage, local: number, dtstamp: string): string[] {
  const where = [item.city, pkg.country].filter(Boolean).join(", ");
  const details = [
    item.quantity > 1 ? `${item.quantity} ${item.type === "hotel" ? "rooms" : item.type === "flight" ? "seats" : "people"}` : "",
    item.price_inr ? `Price: INR ${item.price_inr.toLocaleString("en-IN")}` : "Free",
    `Trip ${pkg.trip_id}`,
  ].filter(Boolean);
  const lines = [
    "BEGIN:VEVENT",
    `UID:${item.item_id}.${pkg.trip_id}@${DOMAIN}`,
    `DTSTAMP:${dtstamp}`,
  ];
  if (item.start.length <= 10) {
    // A hotel stay: whole days from check-in up to (not including) check-out.
    lines.push(`DTSTART;VALUE=DATE:${dateOnly(item.start)}`, `DTEND;VALUE=DATE:${dateOnly(item.end ?? dayAfter(item.start))}`);
    lines.push("TRANSP:TRANSPARENT");
  } else {
    lines.push(`DTSTART:${utcStamp(item.start, offsetOf(item, "start", local))}`);
    lines.push(`DTEND:${item.end ? utcStamp(item.end, offsetOf(item, "end", local)) : utcStamp(item.start, offsetOf(item, "start", local), ONE_HOUR)}`);
  }
  lines.push(`SUMMARY:${text((PREFIX[item.type] ?? "") + item.name)}`, `LOCATION:${text(where)}`, `DESCRIPTION:${text(details.join("\n"))}`, "END:VEVENT");
  return lines;
}

function tripEvent(pkg: TripPackage, dtstamp: string): string[] {
  const route = (pkg.cities ?? []).join(" - ");
  return [
    "BEGIN:VEVENT",
    `UID:trip.${pkg.trip_id}@${DOMAIN}`,
    `DTSTAMP:${dtstamp}`,
    `DTSTART;VALUE=DATE:${dateOnly(pkg.start_date)}`,
    `DTEND;VALUE=DATE:${dateOnly(dayAfter(pkg.end_date))}`,
    "TRANSP:TRANSPARENT",
    `SUMMARY:${text(`Holiday: ${route}`)}`,
    ...(pkg.country ? [`LOCATION:${text(pkg.country)}`] : []),
    `DESCRIPTION:${text(`Trip ${pkg.trip_id}. Total: INR ${pkg.total_inr.toLocaleString("en-IN")}`)}`,
    "END:VEVENT",
  ];
}

/** The plan as the text of an .ics file. `now` is the time stamped on each event. */
export function tripCalendar(pkg: TripPackage, now: Date = new Date()): string {
  const local = localOffset(pkg.country);
  const dtstamp = stamp(now);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//NeuroNix//Build My Holiday//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${text(`Holiday: ${(pkg.cities ?? []).join(" - ")}`)}`,
    ...(pkg.start_date && pkg.end_date ? tripEvent(pkg, dtstamp) : []),
    ...(pkg.items ?? []).flatMap((item) => itemEvent(item, pkg, local, dtstamp)),
    "END:VCALENDAR",
  ];
  return lines.map(fold).join("\r\n") + "\r\n";
}

export const calendarFileName = (pkg: TripPackage) => `holiday-${pkg.trip_id || "plan"}.ics`;
