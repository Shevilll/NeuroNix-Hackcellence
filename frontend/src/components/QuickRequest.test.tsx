import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import QuickRequest from "./QuickRequest";

vi.mock("../api/endpoints", () => ({
  quickRequest: vi.fn().mockResolvedValue({ fields: { origin: "BLR", nights: 6 }, missing: ["budget"], unclear: [] }),
}));

describe("QuickRequest", () => {
  it("passes the parsed fields up and names what is still missing", async () => {
    const onParsed = vi.fn();
    render(<QuickRequest onParsed={onParsed} />);
    await userEvent.type(screen.getByLabelText(/describe your trip/i), "from Bengaluru 6 nights");
    await userEvent.click(screen.getByRole("button", { name: /fill the form/i }));
    expect(onParsed).toHaveBeenCalledWith(expect.objectContaining({ fields: { origin: "BLR", nights: 6 } }));
    expect(await screen.findByRole("status")).toHaveTextContent(/budget/);
  });

  it("turns off browser autofill and history suggestions on the trip description box", () => {
    render(<QuickRequest onParsed={vi.fn()} />);
    expect(screen.getByLabelText(/describe your trip/i)).toHaveAttribute("autocomplete", "off");
  });
});
