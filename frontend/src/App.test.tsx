import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import App from "./App";

describe("App shell", () => {
  it("shows the product name in the header and a main landmark", () => {
    render(<App />);
    expect(screen.getByRole("banner")).toHaveTextContent("Build My Holiday");
    expect(screen.getByRole("main")).toBeInTheDocument();
  });
});
