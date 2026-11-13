import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { makePackage } from "../test/fixtures";
import PackagePicker, { type PackageChoice } from "./PackagePicker";

const choices: PackageChoice[] = [
  { key: "recommended", label: "Recommended", package_id: "a", package: makePackage() },
  { key: "cheapest", label: "Cheapest", package_id: "b", package: makePackage({ total_inr: 219324, cities: ["Tokyo"], nights_per_city: [4], travel_minutes: 1030, avg_stars: 3 }) },
  { key: "fastest", label: "Fastest", package_id: "c", package: makePackage({ total_inr: 219324, travel_minutes: 990 }) },
  { key: "best_rated", label: "Best rated", package_id: "d", package: makePackage({ total_inr: 380000, avg_stars: 5 }) },
];

describe("PackagePicker (G4: the traveler picks one of the packages)", () => {
  it("shows one tab per package with its total, route, travel time and hotel stars", () => {
    render(<PackagePicker choices={choices} value="recommended" budget={350000} onPick={() => {}} />);
    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(4);
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    expect(within(tabs[0]).getByText("₹2,31,924")).toBeInTheDocument();
    expect(within(tabs[0]).getByText(/19 h 10 min/)).toBeInTheDocument();
    expect(within(tabs[0]).getByText(/3\.5 stars/)).toBeInTheDocument();
    expect(within(tabs[1]).getByText(/Tokyo \(4n\)/)).toBeInTheDocument();
  });

  it("marks a package that does not fit the budget", () => {
    render(<PackagePicker choices={choices} value="recommended" budget={350000} onPick={() => {}} />);
    const best = screen.getByRole("tab", { name: /best rated/i });
    expect(within(best).getByText(/over budget/i)).toBeInTheDocument();
    expect(within(screen.getByRole("tab", { name: /cheapest/i })).queryByText(/over budget/i)).toBeNull();
  });

  it("reports the pick", async () => {
    const onPick = vi.fn();
    render(<PackagePicker choices={choices} value="recommended" budget={350000} onPick={onPick} />);
    await userEvent.click(screen.getByRole("tab", { name: /fastest/i }));
    expect(onPick).toHaveBeenCalledWith("fastest");
  });
});
