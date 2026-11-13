import { describe, expect, it } from "vitest";
import { makePackage } from "../test/fixtures";
import { mapPoints } from "../test/mapPoints";
import { buildRoute } from "./route";

const keys = (stops: { key: string }[]) => stops.map((s) => s.key);

describe("buildRoute (the whole trip as stops on a map)", () => {
  it("follows the trip in time order: flight in, hotels, visits, the train, flight home", () => {
    const route = buildRoute(makePackage(), mapPoints);
    expect(keys(route.stops)).toEqual([
      "airport:BLR", "airport:NRT", "hotel:HTL-TYO-001", "attraction:ATT-TYO-004", "hotel:HTL-TYO-001",
      "hotel:HTL-KYO-004", "attraction:ATT-KYO-002", "hotel:HTL-KYO-004", "airport:KIX", "airport:BLR",
    ]);
  });

  it("marks the flight legs apart from the legs on the ground", () => {
    const route = buildRoute(makePackage(), mapPoints);
    expect(route.legs).toHaveLength(route.stops.length - 1);
    expect(route.legs.map((l) => l.mode)).toEqual([
      "flight", "ground", "ground", "ground", "ground", "ground", "ground", "ground", "flight",
    ]);
  });

  it("gives each stop its kind, name and position", () => {
    const [home, , hotel, visit] = buildRoute(makePackage(), mapPoints).stops;
    expect(home).toMatchObject({ kind: "airport", name: "Kempegowda International Airport", lat: 13.1986, lng: 77.7066 });
    expect(hotel).toMatchObject({ kind: "hotel", name: "Ginza Pearl Hotel" });
    expect(visit).toMatchObject({ kind: "attraction", name: "Senso-ji", lat: 35.7148 });
  });

  it("splits the route into the days of the plan, each starting where the day before ended", () => {
    const { days } = buildRoute(makePackage(), mapPoints);
    expect(days.map((d) => d.date)).toEqual([
      "2027-04-09", "2027-04-10", "2027-04-11", "2027-04-12", "2027-04-13", "2027-04-14",
    ]);
    const byDate = Object.fromEntries(days.map((d) => [d.date, keys(d.stops)]));
    expect(byDate["2027-04-09"]).toEqual(["airport:BLR", "airport:NRT"]);
    expect(byDate["2027-04-10"]).toEqual(["airport:NRT", "hotel:HTL-TYO-001"]);
    expect(byDate["2027-04-11"]).toEqual(["hotel:HTL-TYO-001", "attraction:ATT-TYO-004", "hotel:HTL-TYO-001"]);
    expect(byDate["2027-04-12"]).toEqual(["hotel:HTL-TYO-001", "hotel:HTL-KYO-004"]);
    expect(byDate["2027-04-14"]).toEqual(["hotel:HTL-KYO-004", "airport:KIX", "airport:BLR"]);
    for (const day of days) expect(day.legs).toHaveLength(Math.max(0, day.stops.length - 1));
  });

  it("numbers each visit in the order it happens", () => {
    const { stops } = buildRoute(makePackage(), mapPoints);
    expect(stops.filter((s) => s.kind === "attraction").map((s) => s.visit)).toEqual([1, 2]);
    expect(stops.filter((s) => s.kind !== "attraction").every((s) => s.visit === undefined)).toBe(true);
  });

  it("leaves out places the map does not know, instead of failing", () => {
    const route = buildRoute(makePackage(), { ...mapPoints, attractions: {} });
    expect(keys(route.stops)).not.toContain("attraction:ATT-TYO-004");
    expect(route.stops.length).toBeGreaterThan(0);
  });

  it("is empty without map points", () => {
    const route = buildRoute(makePackage(), { airports: {}, hotels: {}, attractions: {}, flights: {} });
    expect(route.stops).toEqual([]);
    expect(route.legs).toEqual([]);
  });
});
