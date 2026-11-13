import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import DatePicker from "./DatePicker";

const MIN = "2027-04-01";
const MAX = "2027-04-20";

function setup(initial = "") {
  const onChange = vi.fn();
  function Harness() {
    const [value, setValue] = useState(initial);
    return (
      <>
        <label id="start-label" htmlFor="start">
          Start date
        </label>
        <DatePicker
          id="start"
          labelledBy="start-label"
          value={value}
          min={MIN}
          max={MAX}
          onChange={(v) => {
            setValue(v);
            onChange(v);
          }}
        />
      </>
    );
  }
  render(<Harness />);
  return { onChange, user: userEvent.setup() };
}

describe("DatePicker (custom calendar)", () => {
  it("renders no native date input", () => {
    setup();
    expect(document.querySelector('input[type="date"]')).toBeNull();
  });

  it("shows a placeholder, then the long date once chosen", async () => {
    const { user, onChange } = setup();
    const trigger = screen.getByRole("button", { name: "Start date" });
    expect(trigger).toHaveTextContent("Pick a date");
    await user.click(trigger);
    await user.click(screen.getByRole("button", { name: "10" }));
    expect(onChange).toHaveBeenCalledWith("2027-04-10");
    expect(screen.getByRole("button", { name: "Start date" })).toHaveTextContent("10 April 2027");
  });

  it("opens a calendar for the month of the value and closes after picking", async () => {
    const { user } = setup("2027-04-05");
    await user.click(screen.getByRole("button", { name: "Start date" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("April 2027");
    await user.click(screen.getByRole("button", { name: "12" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("disables days outside the allowed window", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: "Start date" }));
    expect(screen.getByRole("button", { name: "21" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "1" })).toBeEnabled();
  });

  it("does not let the user move to a month outside the window", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: "Start date" }));
    // The whole window (1-20 April 2027) sits in one month, so neither arrow goes anywhere.
    expect(screen.getByRole("button", { name: /previous month/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /next month/i })).toBeDisabled();
  });

  it("can move to the next month when the window spans two months", async () => {
    const onChange = vi.fn();
    render(<DatePicker id="d" labelledBy="d-label" value="" min="2027-04-25" max="2027-05-10" onChange={onChange} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /pick a date/i }));
    expect(screen.getByRole("dialog")).toHaveTextContent("April 2027");
    await user.click(screen.getByRole("button", { name: /next month/i }));
    expect(screen.getByRole("dialog")).toHaveTextContent("May 2027");
  });

  it("closes on Escape without changing the value", async () => {
    const { user, onChange } = setup();
    await user.click(screen.getByRole("button", { name: "Start date" }));
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });
});
