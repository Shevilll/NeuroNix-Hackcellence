import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { makePackage, reply, stubApi } from "./test/fixtures";

beforeEach(() => {
  sessionStorage.clear();
  window.history.pushState({}, "", "/");
});
afterEach(() => vi.unstubAllGlobals());

describe("navigation", () => {
  it("has links to plan a trip, find a booking and check a trip file", async () => {
    vi.stubGlobal("fetch", vi.fn(stubApi()));
    render(<App />);
    const nav = screen.getByRole("navigation");
    expect(within(nav).getByRole("link", { name: /plan a trip/i })).toHaveAttribute("href", "/");
    expect(within(nav).getByRole("link", { name: /find a booking/i })).toHaveAttribute("href", "/r");
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
