import { describe, expect, it } from "vitest";
import { makePackage } from "../test/fixtures";
import { calendarFileName, tripCalendar } from "./calendar";

const NOW = new Date("2027-01-05T08:00:00Z");

/** The lines of a calendar file, with folded lines joined back up. */
const lines = (ics: string) => ics.replace(/\r\n /g, "").split("\r\n");

/** Each VEVENT as a map of its properties (name with parameters, e.g. "DTSTART;VALUE=DATE"). */
function events(ics: string): Record<string, string>[] {
  const out: Record<string, string>[] = [];
  let cur: Record<string, string> | null = null;
  for (const line of lines(ics)) {
    if (line === "BEGIN:VEVENT") cur = {};
    else if (line === "END:VEVENT") {
      out.push(cur!);
      cur = null;
    } else if (cur) {
      const at = line.indexOf(":");
      cur[line.slice(0, at)] = line.slice(at + 1);
    }
  }
  return out;
}

const byUid = (ics: string, uid: string) => events(ics).find((e) => e.UID === uid)!;

describe("add the whole plan to a calendar (.ics file)", () => {
  it("writes one valid iCalendar file with CRLF line endings", () => {
    const ics = tripCalendar(makePackage(), NOW);
    expect(ics.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics).toMatch(/\r\nPRODID:[^\r\n]+\r\n/);
    expect(ics).not.toMatch(/[^\r]\n/);
  });

  it("has an event for every item of the plan plus one for the whole trip", () => {
    const pkg = makePackage();
    const all = events(tripCalendar(pkg, NOW));
    expect(all).toHaveLength(pkg.items.length + 1);
    expect(all.map((e) => e.SUMMARY)).toEqual(
      expect.arrayContaining(["Flight: AirVeda AV 520 BLR to NRT", "Hotel: Ginza Pearl Hotel", "Senso-ji", "Shinkansen Tokyo to Kyoto"]),
    );
  });

  it("gives each event a stable id, so importing again updates the plan instead of doubling it", () => {
    const a = tripCalendar(makePackage(), NOW);
    const b = tripCalendar(makePackage(), new Date("2027-02-01T00:00:00Z"));
    const ids = events(a).map((e) => e.UID);
    expect(new Set(ids).size).toBe(ids.length);
    expect(events(b).map((e) => e.UID)).toEqual(ids);
    expect(ids).toContain("i4.pkg_test1@build-my-holiday");
  });

  it("puts times in UTC: destination times for visits and transfers", () => {
    const ics = tripCalendar(makePackage(), NOW);
    // Narita bus 11:30-13:10 Japan time (UTC+9).
    const bus = byUid(ics, "i3.pkg_test1@build-my-holiday");
    expect(bus.DTSTART).toBe("20270410T023000Z");
    expect(bus.DTEND).toBe("20270410T041000Z");
  });

  it("reads a flight from India as leaving in IST and landing in local time, and the flight home the other way", () => {
    const ics = tripCalendar(makePackage(), NOW);
    const out = byUid(ics, "i1.pkg_test1@build-my-holiday");
    expect(out.DTSTART).toBe("20270409T182000Z"); // 23:50 IST
    expect(out.DTEND).toBe("20270410T013000Z"); // 10:30 JST
    const home = byUid(ics, "i9.pkg_test1@build-my-holiday");
    expect(home.DTSTART).toBe("20270414T030000Z"); // 12:00 JST
    expect(home.DTEND).toBe("20270414T123000Z"); // 18:00 IST
  });

  it("shows a hotel stay as all-day from check-in up to check-out", () => {
    const hotel = byUid(tripCalendar(makePackage({ country: "Japan" }), NOW), "i2.pkg_test1@build-my-holiday");
    expect(hotel["DTSTART;VALUE=DATE"]).toBe("20270410");
    expect(hotel["DTEND;VALUE=DATE"]).toBe("20270412");
    expect(hotel.LOCATION).toBe("Tokyo\\, Japan");
  });

  it("adds an all-day event for the whole trip, with the route in its title", () => {
    const trip = byUid(tripCalendar(makePackage(), NOW), "trip.pkg_test1@build-my-holiday");
    expect(trip.SUMMARY).toBe("Holiday: Tokyo - Kyoto");
    expect(trip["DTSTART;VALUE=DATE"]).toBe("20270410");
    // All-day end dates are exclusive: the day after the trip ends.
    expect(trip["DTEND;VALUE=DATE"]).toBe("20270415");
  });

  it("uses the UAE time zone for a Dubai trip", () => {
    const pkg = makePackage({
      country: "United Arab Emirates",
      items: [{ item_id: "d1", type: "attraction", name: "Burj Khalifa", city: "Dubai", start: "2027-04-11T18:00", end: "2027-04-11T19:30", quantity: 2, price_inr: 9000, status: "PLANNED" }],
    });
    const visit = byUid(tripCalendar(pkg, NOW), "d1.pkg_test1@build-my-holiday");
    expect(visit.DTSTART).toBe("20270411T140000Z");
    expect(visit.DTEND).toBe("20270411T153000Z");
  });

  it("gives an item with no end time a one-hour slot", () => {
    const pkg = makePackage({
      items: [{ item_id: "x", type: "attraction", name: "Ueno Park", city: "Tokyo", start: "2027-04-11T09:00", end: null, quantity: 1, price_inr: 0, status: "PLANNED" }],
    });
    expect(byUid(tripCalendar(pkg, NOW), "x.pkg_test1@build-my-holiday").DTEND).toBe("20270411T010000Z");
  });

  it("escapes commas, semicolons and backslashes, and folds long lines at 75 characters", () => {
    const name = "Tea; ceremony, garden \\ walk " + "and a very long description of the place ".repeat(3);
    const pkg = makePackage({
      items: [{ item_id: "x", type: "attraction", name, city: "Kyoto", start: "2027-04-13T09:00", end: "2027-04-13T10:00", quantity: 1, price_inr: 0, status: "PLANNED" }],
    });
    const ics = tripCalendar(pkg, NOW);
    for (const raw of ics.split("\r\n")) expect(new TextEncoder().encode(raw).length).toBeLessThanOrEqual(75);
    expect(byUid(ics, "x.pkg_test1@build-my-holiday").SUMMARY).toBe(name.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,"));
  });

  it("stamps every event with the time the file was made", () => {
    for (const e of events(tripCalendar(makePackage(), NOW))) expect(e.DTSTAMP).toBe("20270105T080000Z");
  });

  it("names the file after the trip", () => {
    expect(calendarFileName(makePackage())).toBe("holiday-pkg_test1.ics");
  });
});
