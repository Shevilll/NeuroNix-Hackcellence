import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import Select from "./Select";

const cities = [
  { value: "BLR", label: "Bengaluru (BLR)" },
  { value: "DEL", label: "Delhi (DEL)" },
  { value: "BOM", label: "Mumbai (BOM)" },
];

function setup(props: Partial<React.ComponentProps<typeof Select>> = {}) {
  const onChange = vi.fn();
  function Harness() {
    const [value, setValue] = useState(props.value ?? "");
    return (
      <>
        <label id="city-label" htmlFor="city">
          Departure city
        </label>
        <Select
          id="city"
          labelledBy="city-label"
          placeholder="Select a city"
          options={cities}
          {...props}
          value={value}
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

describe("Select (custom dropdown)", () => {
  it("renders no native <select> element", () => {
    const { user } = setup();
    expect(document.querySelector("select")).toBeNull();
    expect(screen.getByRole("combobox", { name: "Departure city" })).toBeInTheDocument();
    void user;
  });

  it("shows the placeholder until a value is chosen", () => {
    setup();
    expect(screen.getByRole("combobox", { name: "Departure city" })).toHaveTextContent("Select a city");
  });

  it("opens a listbox of options when clicked", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("combobox", { name: "Departure city" }));
    const listbox = screen.getByRole("listbox", { name: "Departure city" });
    expect(within(listbox).getAllByRole("option")).toHaveLength(3);
    expect(screen.getByRole("combobox", { name: "Departure city" })).toHaveAttribute("aria-expanded", "true");
  });

  it("selects an option with the mouse, reports it and closes", async () => {
    const { user, onChange } = setup();
    await user.click(screen.getByRole("combobox", { name: "Departure city" }));
    await user.click(screen.getByRole("option", { name: "Delhi (DEL)" }));
    expect(onChange).toHaveBeenCalledWith("DEL");
    expect(screen.getByRole("combobox", { name: "Departure city" })).toHaveTextContent("Delhi (DEL)");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("can be driven from the keyboard: arrows move, Enter selects, Escape closes", async () => {
    const { user, onChange } = setup();
    const trigger = screen.getByRole("combobox", { name: "Departure city" });
    trigger.focus();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("option", { name: "Bengaluru (BLR)" })).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{ArrowDown}");
    await user.keyboard("{Enter}");
    expect(onChange).toHaveBeenCalledWith("DEL");

    await user.keyboard("{ArrowDown}");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("closes when the user clicks outside", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("combobox", { name: "Departure city" }));
    await user.click(document.body);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("marks the trigger invalid for assistive tech when asked", () => {
    setup({ invalid: true, describedBy: "city-error" });
    const trigger = screen.getByRole("combobox", { name: "Departure city" });
    expect(trigger).toHaveAttribute("aria-invalid", "true");
    expect(trigger).toHaveAttribute("aria-describedby", "city-error");
  });

  it("shows the chosen value when the value is set from outside", () => {
    setup({ value: "BOM" });
    expect(screen.getByRole("combobox", { name: "Departure city" })).toHaveTextContent("Mumbai (BOM)");
  });
});
