import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import BudgetBar from "./BudgetBar";

describe("BudgetBar", () => {
  it("shows the total, the budget and what is left", () => {
    render(<BudgetBar total={231924} budget={350000} />);
    expect(screen.getByText("₹2,31,924")).toBeInTheDocument();
    expect(screen.getByText(/of ₹3,50,000/)).toBeInTheDocument();
    expect(screen.getByText("₹1,18,076 left")).toBeInTheDocument();
    const bar = screen.getByRole("progressbar", { name: /budget used/i });
    expect(bar).toHaveAttribute("aria-valuenow", "66");
  });

  it("says how much the package is over, and caps the bar at 100", () => {
    render(<BudgetBar total={361408} budget={350000} />);
    expect(screen.getByText("₹11,408 over")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
    expect(screen.getByRole("progressbar")).toHaveClass("budget__bar--over");
  });
});
