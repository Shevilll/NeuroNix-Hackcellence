import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { makePackage, okBuild, reply, stubApi } from "./test/fixtures";

beforeEach(() => {
  sessionStorage.clear();
  window.history.pushState({}, "", "/");
});
afterEach(() => vi.unstubAllGlobals());

async function buildMenon() {
  const user = userEvent.setup();
  render(<App />);
  await user.click(await screen.findByRole("button", { name: /load menon example/i }));
  await user.click(screen.getByRole("button", { name: /build my holiday/i }));
  return user;
}

describe("planner: picking one of the packages (G4)", () => {
  it("shows the four packages and switches the plan when another is picked", async () => {
    vi.stubGlobal("fetch", vi.fn(stubApi((url, init) => (url === "/api/packages" && init?.method === "POST" ? reply(200, okBuild()) : undefined))));
    const user = await buildMenon();
    const tabs = await screen.findAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual([
      expect.stringMatching(/Recommended/), expect.stringMatching(/Cheapest/), expect.stringMatching(/Fastest/), expect.stringMatching(/Best rated/),
    ]);
    expect(screen.getByRole("region", { name: /holiday package/i })).toHaveTextContent(/Kyoto/);
    await user.click(screen.getByRole("tab", { name: /best rated/i }));
    expect(screen.getByRole("tab", { name: /best rated/i })).toHaveAttribute("aria-selected", "true");
    expect(within(screen.getByRole("region", { name: /holiday package/i })).getAllByRole("heading", { level: 2 })[0]).not.toHaveTextContent(/Kyoto/);
    expect(screen.getByText("₹33,236 left")).toBeInTheDocument();
  });
});

describe("planner: confirm (M7)", () => {
  it("confirms with an Idempotency-Key and shows the reservation number with a link to its page", async () => {
    const booked = makePackage({ items: makePackage().items.map((i) => ({ ...i, status: "BOOKED" })) });
    let confirmInit: RequestInit | undefined;
    vi.stubGlobal("fetch", vi.fn(stubApi((url, init) => {
      if (url === "/api/packages" && init?.method === "POST") return reply(200, okBuild());
      if (url === "/api/packages/pkg_test1/confirm") { confirmInit = init; return reply(200, { reservation_number: "4435693622", package: booked }); }
      return undefined;
    })));
    const user = await buildMenon();
    await user.click(await screen.findByRole("button", { name: /confirm booking/i }));
    expect(await screen.findByRole("heading", { name: /reservation 4435693622/i })).toBeInTheDocument();
    expect(new Headers(confirmInit?.headers).get("Idempotency-Key")).toBeTruthy();
    expect(screen.getByRole("link", { name: /open the summary page/i })).toHaveAttribute("href", "/r/4435693622");
    expect(screen.getByRole("button", { name: /copy/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /confirm booking/i })).toBeNull();
  });

  it("shows the backend's message when the last seats are gone", async () => {
    vi.stubGlobal("fetch", vi.fn(stubApi((url, init) => {
      if (url === "/api/packages" && init?.method === "POST") return reply(200, okBuild());
      if (url === "/api/packages/pkg_test1/confirm") return reply(409, { detail: { code: "SOLD_OUT", message: "Sorry, the last seats were just booked." } });
      return undefined;
    })));
    const user = await buildMenon();
    await user.click(await screen.findByRole("button", { name: /confirm booking/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Sorry, the last seats were just booked.");
  });
});

describe("planner: surviving a page refresh", () => {
  it("restores the last build from the backend after a reload", async () => {
    const fetchMock = vi.fn(stubApi((url, init) => {
      if (url === "/api/packages" && init?.method === "POST") return reply(200, okBuild());
      if (url === "/api/packages/pkg_test1") return reply(200, makePackage({ version: 3 }));
      if (url === "/api/packages/pkg_cheap") return reply(200, okBuild().alternatives.cheapest.package);
      if (url === "/api/packages/pkg_fast") return reply(200, okBuild().alternatives.fastest.package);
      if (url === "/api/packages/pkg_stars") return reply(200, okBuild().alternatives.best_rated.package);
      return undefined;
    }));
    vi.stubGlobal("fetch", fetchMock);
    await buildMenon();
    await screen.findAllByRole("tab");
    const { unmount } = { unmount: () => undefined };
    unmount();
    document.body.innerHTML = "";

    render(<App />);
    expect(await screen.findAllByRole("tab")).toHaveLength(4);
    await waitFor(() => expect(fetchMock.mock.calls.some(([u]) => u === "/api/packages/pkg_test1")).toBe(true));
    const pkg = screen.getByRole("region", { name: /holiday package/i });
    expect(within(pkg).getByText(/Ginza Pearl Hotel/)).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: /departure city/i })).toHaveTextContent("Bengaluru (BLR)");
  });
});
