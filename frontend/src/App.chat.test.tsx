import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { stubApi } from "./test/fixtures";

beforeEach(() => {
  sessionStorage.clear();
  window.history.pushState({}, "", "/");
});
afterEach(() => vi.unstubAllGlobals());

describe("help chat on every page", () => {
  it.each(["/", "/r", "/check"])("shows the chat launcher on %s", (path) => {
    window.history.pushState({}, "", path);
    vi.stubGlobal("fetch", vi.fn(stubApi()));
    render(<App />);
    expect(screen.getByRole("button", { name: /ask the help chat/i })).toBeInTheDocument();
  });
});
