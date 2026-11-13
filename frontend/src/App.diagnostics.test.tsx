import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App";

const options = {
  departure_cities: [{ airport: "BLR", city: "Bengaluru" }],
  countries: [{ code: "JP", name: "Japan" }],
  rules: { min_nights: 3, max_nights: 10, min_nights_per_city: 2, max_travelers: 9,
    data_window: { first_night: "2027-04-01", last_departure: "2027-04-20" } },
};
const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

afterEach(() => vi.unstubAllGlobals());

function install(buildReplies: unknown[]) {
  const builds: Record<string, unknown>[] = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "/api/options") return reply(200, options);
    if (url === "/api/packages" && init?.method === "POST") {
      builds.push(JSON.parse(init.body as string));
      return reply(200, buildReplies[Math.min(builds.length - 1, buildReplies.length - 1)]);
    }
    return reply(404, { detail: "not found" });
  });
  vi.stubGlobal("fetch", fetchMock);
  return builds;
}

async function submitMenon() {
  const user = userEvent.setup();
  render(<App />);
  await user.click(await screen.findByRole("button", { name: /load an example/i }));
  await user.click(screen.getByRole("menuitem", { name: /menon family/i }));
  return user;
}

describe("App: acting on explanations", () => {
  it("re-runs the request with the dates of a nearby option, keeping everything else", async () => {
    const builds = install([
      { status: "NO_PACKAGE", reasons: [{ code: "NO_ARRIVAL_FLIGHT", message: "No flight." }],
        nearby: [{ kind: "other_dates", start_date: "2027-04-12", end_date: "2027-04-15", nights: 3, total_inr: 120000,
          within_budget: true, message: "Start on 12 Apr (3 nights, back on 15 Apr): ₹1,20,000, within your budget." }] },
      { status: "NO_PACKAGE", reasons: [{ code: "NO_ARRIVAL_FLIGHT", message: "Still no flight." }] },
    ]);
    const user = await submitMenon();
    await user.click(await screen.findByRole("button", { name: /try these dates/i }));
    await waitFor(() => expect(builds).toHaveLength(2));
    expect(builds[1]).toMatchObject({ origin: "BLR", adults: 2, children_ages: [6], budget: 350000,
      start_date: "2027-04-12", nights: 3 });
    expect(await screen.findByText("Still no flight.")).toBeInTheDocument();
  });

  it("raises the budget to the cheapest total and rebuilds", async () => {
    const builds = install([
      { status: "OVER_BUDGET", cheapest_total: 361408, budget: 350000, short_by: 11408, suggestions: ["Raise."],
        suggestion_details: [{ kind: "raise_budget", amount_inr: 11408, message: "Raise your budget by ₹11,408." }],
        cheapest_package: { items: [], cities: [], nights_per_city: [], total_inr: 361408, budget_inr: 350000,
          traveler: {}, start_date: "2027-04-10", end_date: "2027-04-16", country: "Japan" } },
      { status: "NO_PACKAGE", reasons: [{ code: "X", message: "Done." }] },
    ]);
    const user = await submitMenon();
    await user.click(await screen.findByRole("button", { name: /raise budget to ₹3,61,408/i }));
    await waitFor(() => expect(builds).toHaveLength(2));
    expect(builds[1]).toMatchObject({ budget: 361408, start_date: "2027-04-10", nights: 6 });
  });
});
