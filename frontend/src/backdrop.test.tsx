import { render } from "@testing-library/react";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { stubApi } from "./test/fixtures";

const root = process.cwd();

beforeEach(() => {
  sessionStorage.clear();
  vi.stubGlobal("fetch", vi.fn(stubApi(() => undefined)));
});
afterEach(() => vi.unstubAllGlobals());

describe("site backdrop (photo collage behind every page)", () => {
  it("ships the collage image", () => {
    expect(existsSync(resolve(root, "public/backdrop-collage.jpg"))).toBe(true);
  });

  it.each(["/", "/r", "/check", "/credits"])("shows one decorative backdrop on %s", (path) => {
    window.history.pushState({}, "", path);
    const { container } = render(<App />);
    const backdrops = container.querySelectorAll(".backdrop");
    expect(backdrops).toHaveLength(1);
    expect(backdrops[0]).toHaveAttribute("aria-hidden", "true");
  });

  it("turns off the overscroll bounce so the photos never show above the header", () => {
    const base = readFileSync(resolve(root, "src/styles/base.css"), "utf8");
    expect(base).toMatch(/html,\s*body\s*\{[^}]*overscroll-behavior:\s*none/);
  });

  it("softens the photos with a light wash from the tokens", () => {
    const tokens = readFileSync(resolve(root, "src/styles/tokens.css"), "utf8");
    const layout = readFileSync(resolve(root, "src/styles/layout.css"), "utf8");
    expect(tokens).toContain("--backdrop-wash:");
    expect(layout).toMatch(/\.backdrop\s*\{[^}]*backdrop-collage\.jpg/);
    expect(layout).toMatch(/var\(--backdrop-wash\)/);
  });
});
