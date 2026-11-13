import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import Spinner from "./Spinner";

describe("Spinner", () => {
  it("is announced to screen readers with its label", () => {
    render(<Spinner label="Loading trip options" />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading trip options");
  });

  it("can be decorative when inside a button that already has text", () => {
    const { container } = render(<Spinner decorative />);
    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
