import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { NearbyOption, SuggestionDetail } from "../api/endpoints";
import NoPackageNotice from "./NoPackageNotice";
import OverBudgetNotice from "./OverBudgetNotice";

const nearby: NearbyOption[] = [
  { kind: "other_dates", start_date: "2027-04-05", end_date: "2027-04-08", nights: 3, total_inr: 150160, within_budget: true,
    message: "Start on 5 Apr (3 nights, back on 8 Apr): ₹1,50,160, within your budget." },
  { kind: "other_nights", start_date: "2027-04-04", end_date: "2027-04-09", nights: 5, total_inr: 400000, within_budget: false,
    message: "Stay 5 nights (5 nights, back on 9 Apr): ₹4,00,000, which is ₹50,000 over your budget." },
];

describe("NoPackageNotice", () => {
  const reasons = [{ code: "NO_ARRIVAL_FLIGHT", message: "No flight from Delhi (DEL) lands in Japan on 4 Apr 2027." }];

  it("explains why, as an alert", () => {
    render(<NoPackageNotice result={{ status: "NO_PACKAGE", reasons, nearby: [] }} onTry={() => {}} />);
    expect(screen.getByRole("alert")).toHaveTextContent("No package is possible");
    expect(screen.getByText(/No flight from Delhi/)).toBeInTheDocument();
  });

  it("offers nearby options and passes the chosen dates and nights to onTry", async () => {
    const onTry = vi.fn();
    render(<NoPackageNotice result={{ status: "NO_PACKAGE", reasons, nearby }} onTry={onTry} />);
    const rows = screen.getAllByRole("listitem").filter((li) => li.textContent?.includes("Start on 5 Apr") || li.textContent?.includes("Stay 5 nights"));
    expect(rows).toHaveLength(2);
    await userEvent.click(within(rows[0]).getByRole("button", { name: /try/i }));
    expect(onTry).toHaveBeenCalledWith({ start_date: "2027-04-05", nights: 3 });
  });

  it("says whether each option fits the budget with an icon, not colour alone", () => {
    const { container } = render(<NoPackageNotice result={{ status: "NO_PACKAGE", reasons, nearby }} onTry={() => {}} />);
    expect(screen.getByText(/within your budget/)).toBeInTheDocument();
    expect(container.querySelectorAll(".diag__fit svg").length).toBe(2);
    expect(screen.getAllByText(/^(Within budget|Over budget)$/).length).toBe(2);
  });

  it("has no options section when nothing nearby works", () => {
    render(<NoPackageNotice result={{ status: "NO_PACKAGE", reasons, nearby: [] }} onTry={() => {}} />);
    expect(screen.queryByText(/other dates that work/i)).not.toBeInTheDocument();
  });

  it("works with an older backend that sends no nearby list", () => {
    render(<NoPackageNotice result={{ status: "NO_PACKAGE", reasons }} onTry={() => {}} />);
    expect(screen.getByText(/No flight from Delhi/)).toBeInTheDocument();
  });
});

describe("OverBudgetNotice", () => {
  const details: SuggestionDetail[] = [
    { kind: "fewer_nights", start_date: "2027-04-06", end_date: "2027-04-12", nights: 6, total_inr: 238112,
      message: "Stay 6 nights instead of 7: ₹2,38,112, within your budget." },
    { kind: "other_dates", start_date: "2027-04-07", end_date: "2027-04-14", nights: 7, total_inr: 240000,
      message: "Start on 7 Apr instead of 6 Apr (back on 14 Apr): ₹2,40,000, within your budget." },
    { kind: "raise_budget", amount_inr: 23296, message: "Raise your budget by ₹23,296 to afford the cheapest package (₹2,61,408)." },
  ];
  const result = { status: "OVER_BUDGET" as const, cheapest_total: 261408, budget: 238112, short_by: 23296,
    suggestions: details.map((d) => d.message), suggestion_details: details, cheapest_package: {} as never };

  it("states the gap in rupees", () => {
    render(<OverBudgetNotice result={result} onTry={() => {}} onRaise={() => {}} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Over budget");
    expect(screen.getByRole("alert")).toHaveTextContent("₹2,61,408");
    expect(screen.getByRole("alert")).toHaveTextContent("₹23,296");
  });

  it("lets the traveler apply a suggestion", async () => {
    const onTry = vi.fn();
    render(<OverBudgetNotice result={result} onTry={onTry} onRaise={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: /use 6 nights/i }));
    expect(onTry).toHaveBeenCalledWith({ start_date: "2027-04-06", nights: 6 });
    await userEvent.click(screen.getByRole("button", { name: /use these dates/i }));
    expect(onTry).toHaveBeenLastCalledWith({ start_date: "2027-04-07", nights: 7 });
  });

  it("raises the budget to the cheapest total", async () => {
    const onRaise = vi.fn();
    render(<OverBudgetNotice result={result} onTry={() => {}} onRaise={onRaise} />);
    await userEvent.click(screen.getByRole("button", { name: /raise budget to ₹2,61,408/i }));
    expect(onRaise).toHaveBeenCalledWith(261408);
  });

  it("falls back to plain suggestions from an older backend", () => {
    const old = { ...result, suggestion_details: undefined, suggestions: ["Raise the budget by about ₹23,296."] };
    render(<OverBudgetNotice result={old} onTry={() => {}} onRaise={() => {}} />);
    expect(screen.getByText("Raise the budget by about ₹23,296.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /use/i })).not.toBeInTheDocument();
  });
});
