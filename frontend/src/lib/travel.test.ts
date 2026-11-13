import { describe, expect, it } from "vitest";
import { distanceKm, istOf, legBetween, localZone, toIst, travelMinutes } from "./travel";

const UENO_PARK = { lat: 35.7146, lng: 139.7732 };
const AMEYOKO = { lat: 35.7101, lng: 139.7745 };
const SENSO_JI = { lat: 35.7148, lng: 139.7967 };
const DISNEYLAND = { lat: 35.6329, lng: 139.8804 };

describe("travel time between visits (same formula as backend/app/domain/geo.py)", () => {
  it("measures the straight-line distance from latitude and longitude", () => {
    expect(distanceKm(UENO_PARK, UENO_PARK)).toBe(0);
    expect(distanceKm(SENSO_JI, DISNEYLAND)).toBeCloseTo(11.8, 0);
    expect(distanceKm(UENO_PARK, AMEYOKO)).toBeCloseTo(0.5, 1);
  });

  it("turns distance into minutes, rounded up to 5 and never under 10", () => {
    expect(travelMinutes(0)).toBe(10);
    expect(travelMinutes(distanceKm(UENO_PARK, AMEYOKO))).toBe(15);
    expect(travelMinutes(12)).toBe(50);
  });

  it("knows the local time zone of each country, with Japan as the default", () => {
    expect(localZone("Japan")).toEqual({ abbr: "JST", offset: 540 });
    expect(localZone("United Arab Emirates")).toEqual({ abbr: "GST", offset: 240 });
    expect(localZone(undefined)).toEqual({ abbr: "JST", offset: 540 });
  });

  it("converts a local clock time to IST", () => {
    expect(toIst("10:00", 540)).toBe("06:30");
    expect(toIst("02:00", 540)).toBe("22:30");
    expect(toIst("10:00", 240)).toBe("11:30");
  });

  it("describes the leg from the end of one visit to the next", () => {
    expect(legBetween(UENO_PARK, SENSO_JI, "2027-04-11T11:30", "2027-04-11T12:00")).toEqual({
      km: 2.1, minutes: 20, leave: "11:30", arrive: "11:50", tight: false,
    });
    expect(legBetween(UENO_PARK, SENSO_JI, "2027-04-11T11:30", "2027-04-11T11:30").tight).toBe(true);
  });
});

describe("istOf: a local date and time as the same moment in India", () => {
  it("moves the clock and, when it crosses midnight, the date", () => {
    expect(istOf("2027-04-10T09:20", 540)).toEqual({ date: "2027-04-10", time: "05:50" });
    expect(istOf("2027-04-10T02:00", 540)).toEqual({ date: "2027-04-09", time: "22:30" });
    expect(istOf("2027-04-10T23:00", 240)).toEqual({ date: "2027-04-11", time: "00:30" });
  });

  it("leaves a time that is already in India alone, and has no time for a bare date", () => {
    expect(istOf("2027-04-09T21:40", 330)).toEqual({ date: "2027-04-09", time: "21:40" });
    expect(istOf("2027-04-10", 540)).toBeNull();
  });
});
