import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makePackage, reply, stubApi } from "../test/fixtures";
import { CityPlanOptions } from "./ChangeOptions";

afterEach(() => vi.unstubAllGlobals());

const plans = [
  { cities: ["Osaka", "Kyoto", "Tokyo"], nights_per_city: [2, 2, 2], total_inr: 259504, within_budget: true, current: true },
  { cities: ["Osaka", "Tokyo"], nights_per_city: [4, 2], total_inr: 258020, within_budget: true, current: false },
  { cities: ["Tokyo"], nights_per_city: [6], total_inr: 270000, within_budget: true, current: false },
  { cities: ["Kyoto", "Osaka", "Tokyo"], nights_per_city: [2, 2, 2], total_inr: 261954, within_budget: true, current: false },
];

function setup() {
  vi.stubGlobal("fetch", vi.fn(stubApi((url) => (url === "/api/packages/pkg_test1/city-plans" ? reply(200, plans) : undefined))));
  render(<CityPlanOptions id="pkg_test1" pkg={makePackage({ total_inr: 259504 })} onChanged={() => {}} onClose={() => {}} />);
}

/** The total shown in each row, in display order. */
async function totals() {
  const rows = await screen.findAllByRole("listitem");
  return rows.map((r) => within(r).getByText(/^₹[\d,]+$/).textContent);
}

describe("CityPlanOptions sorting", () => {
  it("keeps the backend's order by default", async () => {
    setup();
    expect(await totals()).toEqual(["₹2,59,504", "₹2,58,020", "₹2,70,000", "₹2,61,954"]);
  });

  it("sorts by price, low to high and high to low", async () => {
    setup();
    await screen.findAllByRole("listitem");
    const price = screen.getByRole("combobox", { name: /price/i });
    await userEvent.selectOptions(price, "low");
    expect(await totals()).toEqual(["₹2,58,020", "₹2,59,504", "₹2,61,954", "₹2,70,000"]);
    await userEvent.selectOptions(price, "high");
    expect(await totals()).toEqual(["₹2,70,000", "₹2,61,954", "₹2,59,504", "₹2,58,020"]);
  });

  it("puts plans with the most places first, cheapest first among equals", async () => {
    setup();
    await screen.findAllByRole("listitem");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: /places/i }), "most");
    expect(await totals()).toEqual(["₹2,59,504", "₹2,61,954", "₹2,58,020", "₹2,70,000"]);
  });

  it("uses the price order to break ties between plans with the same number of places", async () => {
    setup();
    await screen.findAllByRole("listitem");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: /price/i }), "high");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: /places/i }), "most");
    expect(await totals()).toEqual(["₹2,61,954", "₹2,59,504", "₹2,58,020", "₹2,70,000"]);
  });

  it("can put the fewest places first", async () => {
    setup();
    await screen.findAllByRole("listitem");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: /places/i }), "fewest");
    expect(await totals()).toEqual(["₹2,70,000", "₹2,58,020", "₹2,59,504", "₹2,61,954"]);
  });
});
