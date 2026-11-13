import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import PhotoCredits from "./PhotoCredits";

vi.mock("../api/endpoints", () => ({
  getCredits: vi.fn().mockResolvedValue([
    { file: "images/attractions/ATT-KYO-001.jpg", used_for: "Kiyomizu-dera", source_title: "Kiyomizu.jpg",
      source_url: "https://commons.wikimedia.org/wiki/File:K.jpg", author: "Martin Falbisoner",
      license: "CC BY-SA 4.0", license_url: "https://creativecommons.org/licenses/by-sa/4.0" },
  ]),
}));

describe("PhotoCredits", () => {
  it("shows author and license for each photo once opened", async () => {
    render(<PhotoCredits />);
    expect(screen.queryByText(/Martin Falbisoner/)).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /photo credits/i }));
    expect(await screen.findByText(/Martin Falbisoner/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "CC BY-SA 4.0" })).toHaveAttribute("href", expect.stringContaining("creativecommons"));
  });
});
