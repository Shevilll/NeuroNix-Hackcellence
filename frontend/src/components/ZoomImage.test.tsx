import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import ZoomImage from "./ZoomImage";

describe("ZoomImage", () => {
  it("shows a small image that opens a larger one when clicked", async () => {
    render(<ZoomImage src="/a.jpg" caption="Taj Hotel" />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /enlarge photo: taj hotel/i }));
    const dialog = screen.getByRole("dialog");
    expect(dialog.querySelector("img")).toHaveAttribute("src", "/a.jpg");
  });

  it("closes with the minimize button", async () => {
    render(<ZoomImage src="/a.jpg" />);
    await userEvent.click(screen.getByRole("button", { name: /enlarge photo/i }));
    await userEvent.click(screen.getByRole("button", { name: /minimize/i }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("closes on Escape and on a click outside the photo", async () => {
    render(<ZoomImage src="/a.jpg" />);
    await userEvent.click(screen.getByRole("button", { name: /enlarge photo/i }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /enlarge photo/i }));
    await userEvent.click(screen.getByTestId("zoom-backdrop"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
