import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makePackage, reply, stubApi } from "../test/fixtures";
import PackageView from "./PackageView";

afterEach(() => vi.unstubAllGlobals());

describe("PackageView (M4: day-by-day plan in time order)", () => {
  it("groups items by day in time order with a start and end time", () => {
    vi.stubGlobal("fetch", vi.fn(stubApi()));
    render(<PackageView pkg={makePackage()} budget={350000} />);
    const days = screen.getAllByRole("heading", { level: 3 });
    expect(days.map((h) => h.textContent)).toEqual([
      expect.stringMatching(/Fri 9 Apr/), expect.stringMatching(/Sat 10 Apr/), expect.stringMatching(/Sun 11 Apr/),
      expect.stringMatching(/Mon 12 Apr/), expect.stringMatching(/Tue 13 Apr/), expect.stringMatching(/Wed 14 Apr/),
    ]);
    const day10 = screen.getByRole("region", { name: /Sat 10 Apr/ });
    const names = within(day10).getAllByRole("listitem").map((li) => li.textContent);
    expect(names[0]).toMatch(/Narita limousine bus/);
    // The bus runs 11:30-13:10 in Japan, shown in India time (IST, 3 h 30 min behind).
    expect(names[0]).toMatch(/08:00/);
    expect(names[0]).toMatch(/09:40/);
    expect(names[0]).not.toMatch(/11:30|13:10/);
    expect(names[1]).toMatch(/Ginza Pearl Hotel/);
    expect(names[1]).toMatch(/2 nights/);
  });

  it("labels the role of each item in plain words", () => {
    vi.stubGlobal("fetch", vi.fn(stubApi()));
    render(<PackageView pkg={makePackage()} budget={350000} />);
    expect(screen.getByText("Arrival flight")).toBeInTheDocument();
    expect(screen.getByText("Return flight")).toBeInTheDocument();
    expect(screen.getByText("Airport to hotel")).toBeInTheDocument();
    expect(screen.getByText("Hotel to airport")).toBeInTheDocument();
    expect(screen.getByText("Between cities")).toBeInTheDocument();
  });

  it("is read-only without change handlers", () => {
    vi.stubGlobal("fetch", vi.fn(stubApi()));
    render(<PackageView pkg={makePackage()} budget={350000} />);
    expect(screen.queryByRole("button", { name: /change|remove|add an attraction/i })).toBeNull();
  });
});

describe("PackageView changes (M6, G1)", () => {
  it("offers a change button on hotels and flights, remove on attractions, and add on days that can take one", () => {
    vi.stubGlobal("fetch", vi.fn(stubApi()));
    render(<PackageView pkg={makePackage()} budget={350000} edit={{ id: "pkg_test1", onChanged: () => {} }} />);
    expect(screen.getByRole("button", { name: /change hotel.*Tokyo/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /change hotel.*Kyoto/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /change arrival flight/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /change return flight/i })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^remove/i })).toHaveLength(2);
    // Add an attraction: every day with a hotel night (10..13 Apr), not the departure day or the flight-out evening.
    expect(screen.getAllByRole("button", { name: /add an attraction/i })).toHaveLength(4);
    expect(within(screen.getByRole("region", { name: /Wed 14 Apr/ })).queryByRole("button", { name: /add an attraction/i })).toBeNull();
  });

  it("still offers to add an attraction on a day that already has two visits", () => {
    vi.stubGlobal("fetch", vi.fn(stubApi()));
    const base = makePackage();
    const extra = { ...base.items[3], item_id: "i10", name: "Shibuya Crossing", catalog_id: "ATT-TYO-011",
      start: "2027-04-11T10:00", end: "2027-04-11T10:30" };
    render(<PackageView pkg={makePackage({ items: [...base.items, extra] })} budget={350000} edit={{ id: "pkg_test1", onChanged: () => {} }} />);
    const day = screen.getByRole("region", { name: /Sun 11 Apr/ });
    expect(within(day).getAllByRole("button", { name: /^remove/i })).toHaveLength(2);
    expect(within(day).getByRole("button", { name: /add an attraction/i })).toBeInTheDocument();
  });

  it("removes an attraction, then shows the price difference and the warnings the backend sent", async () => {
    const changed = makePackage({ version: 2, items: makePackage().items.filter((i) => i.item_id !== "i4") });
    const calls: Record<string, unknown>[] = [];
    vi.stubGlobal("fetch", vi.fn(stubApi((url, init) => {
      if (url === "/api/packages/pkg_test1/changes") {
        calls.push(JSON.parse(init!.body as string));
        return reply(200, { package_id: "pkg_test1", package: changed, price_diff_inr: 0,
          warnings: [{ code: "EMPTY_DAY", message: "11 Apr has no attractions planned." }] });
      }
      return undefined;
    })));
    const onChanged = vi.fn();
    render(<PackageView pkg={makePackage()} budget={350000} edit={{ id: "pkg_test1", onChanged }} />);
    await userEvent.click(screen.getAllByRole("button", { name: /^remove/i })[0]);
    expect(calls[0]).toMatchObject({ op: "remove_attraction", item_id: "i4", expected_version: 1 });
    expect(onChanged).toHaveBeenCalledWith(changed);
    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent(/checked again/i);
    expect(status).toHaveTextContent("11 Apr has no attractions planned.");
  });

  it("opens the hotel options under the hotel when asked", async () => {
    vi.stubGlobal("fetch", vi.fn(stubApi((url) => (url.startsWith("/api/packages/pkg_test1/options/hotels?city=Kyoto")
      ? reply(200, [{ hotel_id: "H", room_id: "R", name: "Kyoto Inn · Twin", hotel_name: "Kyoto Inn", stars: 4, rating: 8, area: "Gion", rooms: 1, price: 1, price_diff: 500 }])
      : undefined))));
    render(<PackageView pkg={makePackage()} budget={350000} edit={{ id: "pkg_test1", onChanged: () => {} }} />);
    await userEvent.click(screen.getByRole("button", { name: /change hotel.*Kyoto/i }));
    expect(await screen.findByText(/Kyoto Inn/)).toBeInTheDocument();
    expect(screen.getByText("+₹500")).toBeInTheDocument();
  });
});
