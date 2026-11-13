import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makePackage, reply, stubApi } from "../test/fixtures";
import PackageView from "./PackageView";

afterEach(() => vi.unstubAllGlobals());

/** 11 Apr: Senso-ji 09:00-10:00 (i4), then Ueno Park 10:30-12:00 (i10), then Ameyoko 12:00-13:00 (i11). */
function threeVisits() {
  const base = makePackage({ country: "Japan" });
  const senso = base.items.find((i) => i.item_id === "i4")!;
  const ueno = { ...senso, item_id: "i10", name: "Ueno Park", catalog_id: "ATT-TYO-008", start: "2027-04-11T10:30", end: "2027-04-11T12:00" };
  const ameyoko = { ...senso, item_id: "i11", name: "Ameyoko Market", catalog_id: "ATT-TYO-009", start: "2027-04-11T12:00", end: "2027-04-11T13:00" };
  return makePackage({ country: "Japan", items: [...base.items, ueno, ameyoko] });
}

const day11 = () => screen.getByRole("region", { name: /Sun 11 Apr/ });

describe("PackageView: travel time between visits", () => {
  it("shows the travel time and distance between two visits from their latitude and longitude", async () => {
    vi.stubGlobal("fetch", vi.fn(stubApi()));
    render(<PackageView pkg={threeVisits()} budget={350000} />);
    const legs = await within(day11()).findAllByRole("note");
    expect(legs).toHaveLength(2);
    // Senso-ji to Ueno Park: 2.1 km, about 20 min, leaving at 10:00 JST = 06:30 IST. Only IST is shown.
    expect(legs[0]).toHaveTextContent(/20 min/);
    expect(legs[0]).toHaveTextContent(/2\.1 km/);
    expect(legs[0]).toHaveTextContent("06:30–06:50 IST");
    expect(legs[0]).not.toHaveTextContent(/JST|10:00/);
    // Ueno Park to Ameyoko: 0.5 km, 15 min, but Ameyoko starts at 12:00 right away.
    expect(legs[1]).toHaveTextContent(/15 min/);
    expect(legs[1]).toHaveTextContent("08:30–08:45 IST");
    expect(legs[1]).toHaveTextContent(/starts at 08:30 IST/);
  });

  it("shows no travel time on a day with one visit", async () => {
    vi.stubGlobal("fetch", vi.fn(stubApi()));
    render(<PackageView pkg={makePackage()} budget={350000} />);
    await screen.findAllByRole("heading", { level: 3 });
    expect(screen.queryAllByRole("note")).toHaveLength(0);
  });
});

describe("PackageView: every time in India time (IST)", () => {
  it("shows visit times in IST, matching the travel times between them", async () => {
    vi.stubGlobal("fetch", vi.fn(stubApi()));
    render(<PackageView pkg={threeVisits()} budget={350000} />);
    const senso = within(day11()).getAllByRole("listitem").find((li) => /Senso-ji/.test(li.textContent ?? ""))!;
    // Senso-ji 09:00-10:00 in Tokyo is 05:30-06:30 IST; the trip to Ueno Park leaves at 06:30 IST.
    expect(senso).toHaveTextContent(/05:30/);
    expect(senso).toHaveTextContent(/06:30/);
    expect(senso.querySelector(".item__time")).toHaveTextContent(/05:30.*06:30.*IST/);
    expect(screen.getByText(/all times are india time \(IST\)/i)).toBeInTheDocument();
  });

  it("shows the arrival flight leaving in IST and landing in IST", () => {
    vi.stubGlobal("fetch", vi.fn(stubApi()));
    render(<PackageView pkg={makePackage({ country: "Japan" })} budget={350000} />);
    // Leaves Bengaluru 23:50 IST on 9 Apr; lands in Tokyo 10:30 JST on 10 Apr = 07:00 IST.
    const flight = screen.getAllByRole("listitem").find((li) => /Arrival flight/.test(li.textContent ?? ""))!;
    expect(flight).toHaveTextContent(/23:50/);
    expect(flight).toHaveTextContent(/07:00/);
    expect(flight).not.toHaveTextContent(/10:30/);
  });
});

describe("PackageView: drag visits into a new order", () => {
  function withChanges(calls: Record<string, unknown>[]) {
    return stubApi((url, init) => {
      if (url === "/api/packages/pkg_test1/changes") {
        calls.push(JSON.parse(init!.body as string));
        return reply(200, { package_id: "pkg_test1", package: threeVisits(), price_diff_inr: 0, warnings: [] });
      }
      return undefined;
    });
  }

  it("dropping one visit on another asks the backend to reorder that day", async () => {
    const calls: Record<string, unknown>[] = [];
    vi.stubGlobal("fetch", vi.fn(withChanges(calls)));
    const onChanged = vi.fn();
    render(<PackageView pkg={threeVisits()} budget={350000} edit={{ id: "pkg_test1", onChanged }} />);
    const rows = within(day11()).getAllByRole("listitem").filter((li) => li.getAttribute("draggable") === "true");
    expect(rows).toHaveLength(3);
    fireEvent.dragStart(rows[2]);
    fireEvent.dragOver(rows[0]);
    fireEvent.drop(rows[0]);
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toMatchObject({ op: "reorder_attractions", date: "2027-04-11", item_ids: ["i11", "i4", "i10"], moved_id: "i11", expected_version: 1 });
    await vi.waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it("moves a visit with the arrow keys on its handle", async () => {
    const calls: Record<string, unknown>[] = [];
    vi.stubGlobal("fetch", vi.fn(withChanges(calls)));
    render(<PackageView pkg={threeVisits()} budget={350000} edit={{ id: "pkg_test1", onChanged: () => {} }} />);
    const handle = within(day11()).getByRole("button", { name: /^move Senso-ji/i });
    handle.focus();
    await userEvent.keyboard("{ArrowDown}");
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toMatchObject({ op: "reorder_attractions", item_ids: ["i10", "i4", "i11"], moved_id: "i4" });
  });

  it("shows the reason when the backend refuses the new order", async () => {
    vi.stubGlobal("fetch", vi.fn(stubApi((url) => (url === "/api/packages/pkg_test1/changes"
      ? reply(422, { detail: { message: "Senso-ji does not fit in that order: it would end after it closes.", violations: [] } })
      : undefined))));
    render(<PackageView pkg={threeVisits()} budget={350000} edit={{ id: "pkg_test1", onChanged: () => {} }} />);
    within(day11()).getByRole("button", { name: /^move Senso-ji/i }).focus();
    await userEvent.keyboard("{ArrowDown}");
    expect(await screen.findByRole("alert")).toHaveTextContent("Senso-ji does not fit in that order: it would end after it closes.");
  });

  it("has nothing to drag when read-only or when a day has one visit", () => {
    vi.stubGlobal("fetch", vi.fn(stubApi()));
    const { unmount } = render(<PackageView pkg={threeVisits()} budget={350000} />);
    expect(document.querySelectorAll('[draggable="true"]')).toHaveLength(0);
    unmount();
    render(<PackageView pkg={makePackage()} budget={350000} edit={{ id: "pkg_test1", onChanged: () => {} }} />);
    expect(screen.queryAllByRole("button", { name: /^move/i })).toHaveLength(0);
  });
});

describe("PackageView: fix a day saved without time to travel", () => {
  it("offers to fix the timings of a day whose visits have no time to travel between them", async () => {
    const calls: Record<string, unknown>[] = [];
    vi.stubGlobal("fetch", vi.fn(stubApi((url, init) => {
      if (url === "/api/packages/pkg_test1/changes") {
        calls.push(JSON.parse(init!.body as string));
        return reply(200, { package_id: "pkg_test1", package: threeVisits(), price_diff_inr: 0, warnings: [] });
      }
      return undefined;
    })));
    const onChanged = vi.fn();
    render(<PackageView pkg={threeVisits()} budget={350000} edit={{ id: "pkg_test1", onChanged }} />);
    await userEvent.click(await within(day11()).findByRole("button", { name: /fix the timings/i }));
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toMatchObject({ op: "space_visits", date: "2027-04-11", expected_version: 1 });
    await vi.waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it("shows the reason when the day cannot take the travel time", async () => {
    vi.stubGlobal("fetch", vi.fn(stubApi((url) => (url === "/api/packages/pkg_test1/changes"
      ? reply(422, { detail: { message: "The visits on 11 Apr do not fit with time to travel between them. Remove one and try again.", violations: [] } })
      : undefined))));
    render(<PackageView pkg={threeVisits()} budget={350000} edit={{ id: "pkg_test1", onChanged: () => {} }} />);
    await userEvent.click(await within(day11()).findByRole("button", { name: /fix the timings/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Remove one and try again.");
  });

  it("tells the traveller which visits were taken off to make room", async () => {
    vi.stubGlobal("fetch", vi.fn(stubApi((url) => (url === "/api/packages/pkg_test1/changes"
      ? reply(200, { package_id: "pkg_test1", package: threeVisits(), price_diff_inr: -1512,
        warnings: [{ code: "VISIT_DROPPED", message: "Ameyoko Market was taken off 11 Apr: it did not fit with time to travel between visits." }] })
      : undefined))));
    render(<PackageView pkg={threeVisits()} budget={350000} edit={{ id: "pkg_test1", onChanged: () => {} }} />);
    await userEvent.click(await within(day11()).findByRole("button", { name: /fix the timings/i }));
    expect(await screen.findByRole("status")).toHaveTextContent("Ameyoko Market was taken off 11 Apr");
  });

  it("does not offer the fix when every visit has time to travel, or when read-only", async () => {
    vi.stubGlobal("fetch", vi.fn(stubApi()));
    const spaced = threeVisits();
    spaced.items = spaced.items.map((i) => (i.item_id === "i11" ? { ...i, start: "2027-04-11T12:30", end: "2027-04-11T13:30" } : i));
    const { unmount } = render(<PackageView pkg={spaced} budget={350000} edit={{ id: "pkg_test1", onChanged: () => {} }} />);
    await within(day11()).findAllByRole("note");
    expect(screen.queryByRole("button", { name: /fix the timings/i })).toBeNull();
    unmount();
    render(<PackageView pkg={threeVisits()} budget={350000} />);
    await within(day11()).findAllByRole("note");
    expect(screen.queryByRole("button", { name: /fix the timings/i })).toBeNull();
  });
});
