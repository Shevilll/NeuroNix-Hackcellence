import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import CityRoute from "./CityRoute";
import Icon, { ICON_NAMES, ItemIcon } from "./Icon";

describe("Icon", () => {
  it.each(ICON_NAMES)("%s is an inline SVG that takes its colour from the text", (name) => {
    const { container } = render(<Icon name={name} />);
    const svg = container.querySelector("svg")!;
    expect(svg).toBeInTheDocument();
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(svg).toHaveAttribute("stroke", "currentColor");
    expect(svg.querySelectorAll("path").length).toBeGreaterThan(0);
  });

  it("is announced when given a label", () => {
    render(<Icon name="warning" label="Warning" />);
    expect(screen.getByRole("img", { name: "Warning" })).toBeInTheDocument();
  });

  it("scales with the text by default", () => {
    const { container } = render(<Icon name="check" />);
    expect(container.querySelector("svg")).toHaveClass("icon");
  });

  it("has a distinct drawing for every icon", () => {
    const drawings = ICON_NAMES.map((n) => render(<Icon name={n} />).container.innerHTML);
    expect(new Set(drawings).size).toBe(ICON_NAMES.length);
  });
});

describe("ItemIcon", () => {
  it("shows a different icon for each kind of trip item", () => {
    const kinds = ["flight", "hotel", "transfer", "attraction"] as const;
    const drawings = kinds.map((k) => render(<ItemIcon type={k} />).container.innerHTML);
    expect(new Set(drawings).size).toBe(4);
  });
});

describe("CityRoute", () => {
  it("lists cities with nights and an arrow icon between them", () => {
    const { container } = render(<CityRoute cities={["Tokyo", "Kyoto", "Osaka"]} nights={[2, 2, 2]} />);
    expect(container).toHaveTextContent("Tokyo (2n)");
    expect(container).toHaveTextContent("Osaka (2n)");
    expect(container.querySelectorAll("svg")).toHaveLength(2);
    expect(container.textContent).not.toMatch(/[→>]/);
  });

  it("has no arrow for a single city", () => {
    const { container } = render(<CityRoute cities={["Dubai"]} nights={[4]} />);
    expect(container.querySelectorAll("svg")).toHaveLength(0);
    expect(container).toHaveTextContent("Dubai (4n)");
  });

  it("reads naturally for screen readers", () => {
    const { container } = render(<CityRoute cities={["Tokyo", "Kyoto"]} nights={[2, 3]} />);
    expect(container.querySelector(".sr-only")).toHaveTextContent("then");
  });
});
