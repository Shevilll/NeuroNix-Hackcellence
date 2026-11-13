import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { stubApi } from "./test/fixtures";

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  window.history.pushState({}, "", "/");
});
afterEach(() => vi.unstubAllGlobals());

const menuButton = () => screen.getByRole("button", { name: "Menu" });

describe("mobile menu button in the header", () => {
  it("is a closed menu button drawn with an SVG icon that controls the header menu", () => {
    vi.stubGlobal("fetch", vi.fn(stubApi()));
    render(<App />);
    const button = menuButton();
    expect(button).toHaveAccessibleName("Menu");
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(button.querySelector("svg")).not.toBeNull();
    const menu = document.getElementById(button.getAttribute("aria-controls")!);
    expect(menu).not.toBeNull();
    expect(menu).not.toHaveClass("header-menu--open");
    expect(within(menu!).getByRole("navigation")).toBeInTheDocument();
  });

  it("opens and closes the menu, and says whether it is open", async () => {
    vi.stubGlobal("fetch", vi.fn(stubApi()));
    const user = userEvent.setup();
    render(<App />);
    await user.click(menuButton());
    expect(menuButton()).toHaveAttribute("aria-expanded", "true");
    expect(menuButton().querySelector("svg path")).toHaveAttribute("d", "M18 6 6 18");
    expect(document.getElementById(menuButton().getAttribute("aria-controls")!)).toHaveClass("header-menu--open");
    await user.click(menuButton());
    expect(menuButton()).toHaveAttribute("aria-expanded", "false");
  });

  it("closes when a link is chosen and the page changes", async () => {
    vi.stubGlobal("fetch", vi.fn(stubApi()));
    const user = userEvent.setup();
    render(<App />);
    await user.click(menuButton());
    await user.click(within(screen.getByRole("navigation")).getByRole("link", { name: /check a trip file/i }));
    expect(window.location.pathname).toBe("/check");
    expect(menuButton()).toHaveAttribute("aria-expanded", "false");
  });

  it("closes on Escape and gives focus back to the menu button", async () => {
    vi.stubGlobal("fetch", vi.fn(stubApi()));
    const user = userEvent.setup();
    render(<App />);
    await user.click(menuButton());
    await user.keyboard("{Escape}");
    expect(menuButton()).toHaveAttribute("aria-expanded", "false");
    expect(menuButton()).toHaveFocus();
  });

  it("closes on a click outside the header", async () => {
    vi.stubGlobal("fetch", vi.fn(stubApi()));
    const user = userEvent.setup();
    render(<App />);
    await user.click(menuButton());
    await act(async () => {
      document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    expect(menuButton()).toHaveAttribute("aria-expanded", "false");
  });

  it("does not clash with other Open buttons on the page", () => {
    vi.stubGlobal("fetch", vi.fn(stubApi()));
    render(<App />);
    expect(screen.queryByRole("button", { name: /open/i })).toBeNull();
  });

  it("is labelled in Hindi when the site is in Hindi", () => {
    localStorage.setItem("bmh.lang", "hi");
    vi.stubGlobal("fetch", vi.fn(stubApi()));
    render(<App />);
    expect(screen.getByRole("button", { name: "मेनू" })).toBeInTheDocument();
  });
});
