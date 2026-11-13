import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { TripOptions } from "../api/types";
import TripForm from "./TripForm";

const options: TripOptions = {
  departure_cities: [
    { airport: "BLR", city: "Bengaluru" },
    { airport: "DEL", city: "Delhi" },
  ],
  countries: [
    { code: "JP", name: "Japan" },
    { code: "AE", name: "United Arab Emirates" },
  ],
  rules: {
    min_nights: 3,
    max_nights: 10,
    min_nights_per_city: 2,
    max_travelers: 9,
    data_window: { first_night: "2027-04-01", last_departure: "2027-04-20" },
  },
};

function setup(props: Partial<React.ComponentProps<typeof TripForm>> = {}) {
  const onSubmit = vi.fn();
  render(<TripForm options={options} onSubmit={onSubmit} {...props} />);
  return { onSubmit, user: userEvent.setup() };
}

describe("TripForm", () => {
  it("starts empty with all 7 request fields", () => {
    setup();
    expect(screen.getByLabelText(/departure city/i)).toHaveValue("");
    expect(screen.getByLabelText(/destination country/i)).toHaveValue("");
    expect(screen.getByLabelText(/start date/i)).toHaveValue("");
    expect(screen.getByLabelText(/nights/i)).toHaveValue(null);
    expect(screen.getByLabelText(/adults/i)).toHaveValue(null);
    expect(screen.getByLabelText(/children/i)).toHaveValue(null);
    expect(screen.getByLabelText(/budget/i)).toHaveValue("");
  });

  it("lists cities and countries from the options", () => {
    setup();
    expect(screen.getByRole("option", { name: /Bengaluru \(BLR\)/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Japan" })).toBeInTheDocument();
  });

  it("shows a message next to each invalid field and does not submit", async () => {
    const { user, onSubmit } = setup();
    await user.click(screen.getByRole("button", { name: /build my holiday/i }));
    expect(screen.getByText("Choose a departure city.")).toBeInTheDocument();
    expect(screen.getByText("Choose a destination country.")).toBeInTheDocument();
    expect(screen.getByText(/at least 1 adult/i)).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("marks invalid fields for assistive tech", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: /build my holiday/i }));
    expect(screen.getByLabelText(/departure city/i)).toHaveAttribute("aria-invalid", "true");
  });

  it("shows one age input per child", async () => {
    const { user } = setup();
    await user.type(screen.getByLabelText(/children/i), "2");
    expect(screen.getAllByLabelText(/age of child/i)).toHaveLength(2);
    await user.clear(screen.getByLabelText(/children/i));
    await user.type(screen.getByLabelText(/children/i), "1");
    expect(screen.getAllByLabelText(/age of child/i)).toHaveLength(1);
  });

  it("loads the Menon example and submits the API request", async () => {
    const { user, onSubmit } = setup();
    await user.click(screen.getByRole("button", { name: /load menon example/i }));
    await user.click(screen.getByRole("button", { name: /build my holiday/i }));
    expect(onSubmit).toHaveBeenCalledWith({
      origin: "BLR",
      country: "JP",
      start_date: "2027-04-10",
      nights: 6,
      adults: 2,
      children_ages: [6],
      budget: 350000,
    });
  });

  it("shows a date-window message for a return after 20 April", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: /load menon example/i }));
    await user.clear(screen.getByLabelText(/start date/i));
    await user.type(screen.getByLabelText(/start date/i), "2027-04-18");
    await user.click(screen.getByRole("button", { name: /build my holiday/i }));
    expect(screen.getByText(/on or before 20 April 2027/)).toBeInTheDocument();
  });

  it("clears a field's message when the user edits it", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: /build my holiday/i }));
    await user.selectOptions(screen.getByLabelText(/departure city/i), "BLR");
    expect(screen.queryByText("Choose a departure city.")).not.toBeInTheDocument();
  });

  it("disables the submit button while building", () => {
    setup({ busy: true });
    expect(screen.getByRole("button", { name: /building/i })).toBeDisabled();
  });

  it("shows a server-side error message when given", () => {
    setup({ serverError: "The server could not build a package." });
    expect(screen.getByRole("alert")).toHaveTextContent("The server could not build a package.");
  });
});
