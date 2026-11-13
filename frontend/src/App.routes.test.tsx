import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { bookings, makePackage, noContent, reply, stubApi } from "./test/fixtures";

beforeEach(() => {
  sessionStorage.clear();
  window.history.pushState({}, "", "/");
});
afterEach(() => vi.unstubAllGlobals());

describe("navigation", () => {
  it("has links to plan a trip, the bookings and check a trip file", async () => {
    vi.stubGlobal("fetch", vi.fn(stubApi()));
    render(<App />);
    const nav = screen.getByRole("navigation");
    expect(within(nav).getByRole("link", { name: /plan a trip/i })).toHaveAttribute("href", "/");
    expect(within(nav).getByRole("link", { name: /^bookings$/i })).toHaveAttribute("href", "/r");
    expect(within(nav).getByRole("link", { name: /check a trip file/i })).toHaveAttribute("href", "/check");
  });
});

describe("site footer", () => {
  it("shows a footer on every page with the photo source", async () => {
    vi.stubGlobal("fetch", vi.fn(stubApi()));
    render(<App />);
    const footer = screen.getByRole("contentinfo");
    expect(footer).toHaveTextContent(/Build My Holiday/);
    expect(footer).toHaveTextContent(/Wikimedia Commons/);
  });
});

describe("/credits (photo credits from images/ATTRIBUTIONS.md)", () => {
  it("is linked from the footer on every page", async () => {
    vi.stubGlobal("fetch", vi.fn(stubApi()));
    render(<App />);
    expect(within(screen.getByRole("contentinfo")).getByRole("link", { name: /photo credits/i })).toHaveAttribute("href", "/credits");
  });

  it("lists every photo with what it shows, its author, source and licence", async () => {
    vi.stubGlobal("fetch", vi.fn(stubApi()));
    window.history.pushState({}, "", "/credits");
    render(<App />);
    expect(screen.getByRole("heading", { level: 1, name: /photo credits/i })).toBeInTheDocument();
    const rows = await screen.findAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText("Kiyomizu-dera")).toBeInTheDocument();
    expect(within(rows[0]).getByText(/Martin Falbisoner/)).toBeInTheDocument();
    expect(within(rows[0]).getByRole("link", { name: "Kiyomizu.jpg" })).toHaveAttribute("href", "https://commons.wikimedia.org/wiki/File:Kiyomizu.jpg");
    expect(within(rows[0]).getByRole("link", { name: "CC BY-SA 4.0" })).toHaveAttribute("href", "https://creativecommons.org/licenses/by-sa/4.0");
    expect(within(rows[1]).getByText(/Jane Doe/)).toBeInTheDocument();
  });

  it("says so when the credits cannot be loaded", async () => {
    vi.stubGlobal("fetch", vi.fn(stubApi((url) => (url === "/api/credits" ? reply(500, { detail: "boom" }) : undefined))));
    window.history.pushState({}, "", "/credits");
    render(<App />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/could not load the photo credits/i);
  });
});

describe("/r without a number", () => {
  it("explains where the reservation number comes from", async () => {
    vi.stubGlobal("fetch", vi.fn(stubApi()));
    window.history.pushState({}, "", "/r");
    render(<App />);
    const help = screen.getByRole("region", { name: /where to find your number/i });
    expect(help).toHaveTextContent(/10-digit/);
    expect(within(help).getByRole("link", { name: /plan a trip/i })).toHaveAttribute("href", "/");
  });
});

/** A fetch stub with two bookings that records DELETE calls; `fail` makes deletes fail. */
function bookingsApi(fail = false) {
  const deletes: string[] = [];
  let rows = [...bookings];
  const fetchMock = vi.fn(stubApi((url, init) => {
    if (init?.method === "DELETE") {
      deletes.push(url);
      if (fail) return reply(500, { detail: "boom" });
      if (url === "/api/reservations") {
        const deleted = rows.length;
        rows = [];
        return reply(200, { deleted });
      }
      rows = rows.filter((r) => !url.endsWith(r.reservation_number));
      return noContent();
    }
    if (url === "/api/reservations") return reply(200, rows);
    return undefined;
  }));
  vi.stubGlobal("fetch", fetchMock);
  return deletes;
}

describe("/r: all bookings, with delete (demo reset)", () => {
  it("lists every booking with its number, route, dates, travellers and total", async () => {
    bookingsApi();
    window.history.pushState({}, "", "/r");
    render(<App />);
    const list = await screen.findByRole("region", { name: /all bookings/i });
    expect(within(list).getByRole("heading", { name: /all bookings \(2\)/i })).toBeInTheDocument();
    const rows = within(list).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("4435693622");
    expect(rows[0]).toHaveTextContent(/Tokyo/);
    expect(rows[0]).toHaveTextContent(/Osaka/);
    expect(rows[0]).toHaveTextContent("10 – 16 Apr 2027");
    expect(rows[0]).toHaveTextContent("2 adults, 1 child");
    expect(rows[0]).toHaveTextContent("₹2,31,924");
    expect(within(rows[0]).getByRole("link", { name: /open booking 4435693622/i })).toHaveAttribute("href", "/r/4435693622");
    expect(rows[1]).toHaveTextContent("3199595112");
  });

  it("deletes one booking only after the traveller confirms", async () => {
    const deletes = bookingsApi();
    const user = userEvent.setup();
    window.history.pushState({}, "", "/r");
    render(<App />);
    const list = await screen.findByRole("region", { name: /all bookings/i });
    await user.click(within(list).getByRole("button", { name: /delete booking 4435693622/i }));
    expect(deletes).toEqual([]);
    expect(within(list).getByText(/gives its seats and rooms back/i)).toBeInTheDocument();
    await user.click(within(list).getByRole("button", { name: /yes, delete/i }));
    expect(await screen.findByRole("status")).toHaveTextContent(/booking 4435693622 was deleted/i);
    expect(deletes).toEqual(["/api/reservations/4435693622"]);
    expect(within(list).getAllByRole("listitem")).toHaveLength(1);
    expect(within(list).getByRole("heading", { name: /all bookings \(1\)/i })).toBeInTheDocument();
  });

  it("keeps the booking when the traveller says no", async () => {
    const deletes = bookingsApi();
    const user = userEvent.setup();
    window.history.pushState({}, "", "/r");
    render(<App />);
    const list = await screen.findByRole("region", { name: /all bookings/i });
    await user.click(within(list).getByRole("button", { name: /delete booking 4435693622/i }));
    await user.click(within(list).getByRole("button", { name: /keep it/i }));
    expect(deletes).toEqual([]);
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
  });

  it("deletes every booking after one confirmation, then shows where numbers come from", async () => {
    const deletes = bookingsApi();
    const user = userEvent.setup();
    window.history.pushState({}, "", "/r");
    render(<App />);
    const list = await screen.findByRole("region", { name: /all bookings/i });
    await user.click(within(list).getByRole("button", { name: /delete all bookings/i }));
    expect(within(list).getByText(/all 2 bookings/i)).toBeInTheDocument();
    await user.click(within(list).getByRole("button", { name: /yes, delete all/i }));
    expect(await screen.findByRole("status")).toHaveTextContent(/2 bookings were deleted/i);
    expect(deletes).toEqual(["/api/reservations"]);
    expect(screen.queryByRole("region", { name: /all bookings/i })).toBeNull();
    expect(screen.getByRole("region", { name: /where to find your number/i })).toBeInTheDocument();
  });

  it("says so when a delete fails and keeps the booking in the list", async () => {
    bookingsApi(true);
    const user = userEvent.setup();
    window.history.pushState({}, "", "/r");
    render(<App />);
    const list = await screen.findByRole("region", { name: /all bookings/i });
    await user.click(within(list).getByRole("button", { name: /delete booking 4435693622/i }));
    await user.click(within(list).getByRole("button", { name: /yes, delete/i }));
    expect(await screen.findByRole("alert", {}, { timeout: 5000 })).toHaveTextContent(/could not delete/i);
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
  });

  it("deletes the booking that is open on its own page and goes back to the list", async () => {
    const booked = makePackage({ items: makePackage().items.map((i) => ({ ...i, status: "BOOKED" })) });
    const deletes: string[] = [];
    vi.stubGlobal("fetch", vi.fn(stubApi((url, init) => {
      if (init?.method === "DELETE") { deletes.push(url); return noContent(); }
      if (url === "/api/reservations/4435693622") return reply(200, { reservation_number: "4435693622", package: booked });
      return undefined;
    })));
    const user = userEvent.setup();
    window.history.pushState({}, "", "/r/4435693622");
    render(<App />);
    await screen.findByRole("heading", { name: /reservation 4435693622/i });
    await user.click(screen.getByRole("button", { name: /delete booking 4435693622/i }));
    await user.click(screen.getByRole("button", { name: /yes, delete/i }));
    expect(await screen.findByRole("status")).toHaveTextContent(/booking 4435693622 was deleted/i);
    expect(deletes).toEqual(["/api/reservations/4435693622"]);
    expect(window.location.pathname).toBe("/r");
  });
});

describe("/r/:number (M7: a reservation number opens the summary)", () => {
  it("shows the booked package for a known number", async () => {
    const booked = makePackage({ items: makePackage().items.map((i) => ({ ...i, status: "BOOKED" })) });
    vi.stubGlobal("fetch", vi.fn(stubApi((url) => (url === "/api/reservations/4435693622"
      ? reply(200, { reservation_number: "4435693622", package: booked }) : undefined))));
    window.history.pushState({}, "", "/r/4435693622");
    render(<App />);
    expect(await screen.findByRole("heading", { name: /reservation 4435693622/i })).toBeInTheDocument();
    expect(screen.getAllByText(/booked/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Ginza Pearl Hotel/)).toBeInTheDocument();
    expect(screen.getByText("₹2,31,924")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /print/i })).toBeInTheDocument();
  });

  it("says not found for a wrong number", async () => {
    vi.stubGlobal("fetch", vi.fn(stubApi()));
    window.history.pushState({}, "", "/r/1111111111");
    render(<App />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/not found/i);
  });

  it("lets the traveler type a number on /r and opens it", async () => {
    vi.stubGlobal("fetch", vi.fn(stubApi((url) => (url === "/api/reservations/4435693622"
      ? reply(200, { reservation_number: "4435693622", package: makePackage() }) : undefined))));
    window.history.pushState({}, "", "/r");
    render(<App />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/reservation number/i), "4435693622");
    await user.click(screen.getByRole("button", { name: /open/i }));
    expect(await screen.findByRole("heading", { name: /reservation 4435693622/i })).toBeInTheDocument();
    expect(window.location.pathname).toBe("/r/4435693622");
  });
});

describe("/check (S3: rule checker for any trip file)", () => {
  it("shows the checker page", async () => {
    vi.stubGlobal("fetch", vi.fn(stubApi()));
    window.history.pushState({}, "", "/check");
    render(<App />);
    expect(await screen.findByRole("heading", { name: /check a trip file/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/trip json file/i)).toBeInTheDocument();
  });
});
