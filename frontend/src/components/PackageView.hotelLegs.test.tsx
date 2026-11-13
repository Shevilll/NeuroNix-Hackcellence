import { render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makePackage, places, reply, stubApi } from "../test/fixtures";
import PackageView from "./PackageView";

afterEach(() => vi.unstubAllGlobals());

/** /api/places with the two hotels of the sample package too. */
const withHotels = {
  ...places,
  "HTL-TYO-001": { lat: 35.6717, lng: 139.765 },
  "HTL-KYO-004": { lat: 34.9986, lng: 135.78 },
};
const stub = () => vi.fn(stubApi((url) => (url === "/api/places" ? reply(200, withHotels) : undefined)));
const day = (name: RegExp) => screen.getByRole("region", { name });

describe("PackageView: leaving the hotel and coming back on each day with visits", () => {
  it("shows when to leave the hotel before the first visit and when you are back after the last", async () => {
    vi.stubGlobal("fetch", stub());
    render(<PackageView pkg={makePackage({ country: "Japan" })} budget={350000} />);
    const rows = await within(day(/Sun 11 Apr/)).findAllByRole("note");
    expect(rows).toHaveLength(2);
    // Ginza Pearl Hotel to Senso-ji: 5.6 km, 30 min. Senso-ji is 09:00-10:00 JST = 05:30-06:30 IST.
    expect(rows[0]).toHaveTextContent(/Leave Ginza Pearl Hotel/);
    expect(rows[0]).toHaveTextContent(/30 min/);
    expect(rows[0]).toHaveTextContent(/5\.6 km/);
    expect(rows[0]).toHaveTextContent("05:00–05:30 IST");
    expect(rows[1]).toHaveTextContent(/Back to Ginza Pearl Hotel/);
    expect(rows[1]).toHaveTextContent("06:30–07:00 IST");
    // In time order: leave, the visit, back.
    const order = [...day(/Sun 11 Apr/).querySelectorAll("li")].map((li) => li.textContent ?? "");
    const at = (re: RegExp) => order.findIndex((t) => re.test(t));
    expect(at(/Leave Ginza/)).toBeLessThan(at(/Senso-ji/));
    expect(at(/Senso-ji/)).toBeLessThan(at(/Back to Ginza/));
  });

  it("uses that night's hotel in each city", async () => {
    vi.stubGlobal("fetch", stub());
    render(<PackageView pkg={makePackage({ country: "Japan" })} budget={350000} />);
    const rows = await within(day(/Tue 13 Apr/)).findAllByRole("note");
    // Sakura Garden Hotel to Fushimi Inari: 25 min. The visit is 09:00-11:00 JST = 05:30-07:30 IST.
    expect(rows[0]).toHaveTextContent(/Leave Sakura Garden Hotel/);
    expect(rows[0]).toHaveTextContent("05:05–05:30 IST");
    expect(rows[1]).toHaveTextContent(/Back to Sakura Garden Hotel/);
    expect(rows[1]).toHaveTextContent("07:30–07:55 IST");
  });

  it("shows nothing on a day without visits", async () => {
    vi.stubGlobal("fetch", stub());
    render(<PackageView pkg={makePackage({ country: "Japan" })} budget={350000} />);
    await within(day(/Sun 11 Apr/)).findAllByRole("note");
    expect(within(day(/Mon 12 Apr/)).queryAllByRole("note")).toHaveLength(0);
    expect(within(day(/Wed 14 Apr/)).queryAllByRole("note")).toHaveLength(0);
  });

  it("says so when a visit on the arrival day starts too soon after reaching the hotel", async () => {
    vi.stubGlobal("fetch", stub());
    const base = makePackage({ country: "Japan" });
    const senso = base.items.find((i) => i.item_id === "i4")!;
    // The airport bus reaches the hotel at 13:10 JST (09:40 IST); leaving at 13:00 JST is too early.
    const early = { ...senso, item_id: "i10", start: "2027-04-10T13:30", end: "2027-04-10T14:30" };
    render(<PackageView pkg={makePackage({ country: "Japan", items: [...base.items, early] })} budget={350000} />);
    const rows = await within(day(/Sat 10 Apr/)).findAllByRole("note");
    expect(rows[0]).toHaveTextContent(/Leave Ginza Pearl Hotel/);
    expect(rows[0]).toHaveTextContent(/You reach the hotel at 09:40 IST/);
  });
});
