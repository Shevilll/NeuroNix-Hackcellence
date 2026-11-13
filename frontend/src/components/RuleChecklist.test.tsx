import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import RuleChecklist from "./RuleChecklist";

describe("RuleChecklist", () => {
  it("marks passing and failing groups and lists the problems", () => {
    render(
      <RuleChecklist
        report={{
          valid: false,
          checklist: [{ group: "Flights", ok: true }, { group: "Prices", ok: false }],
          violations: [{ code: "PRICE_TOTAL", group: "Prices", message: "total is not the sum" }],
        }}
      />,
    );
    expect(screen.getByText("Flights").closest("li")).toHaveClass("ok");
    expect(screen.getByText("Prices").closest("li")).toHaveClass("bad");
    expect(screen.getByText(/total is not the sum/)).toBeInTheDocument();
  });
});
