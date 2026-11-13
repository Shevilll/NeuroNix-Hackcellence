import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolve(process.cwd(), "src/styles/tokens.css"), "utf8");

describe("design tokens (Booking Holdings look: light theme only)", () => {
  it("declares the brand tokens", () => {
    for (const token of ["--blue-900", "--blue-600", "--bg", "--surface", "--text", "--border"]) {
      expect(css).toContain(token + ":");
    }
  });

  it("has no dark mode", () => {
    expect(css).not.toMatch(/prefers-color-scheme\s*:\s*dark/);
    expect(css).toMatch(/color-scheme:\s*light/);
  });

  it("uses white surfaces and near-black text", () => {
    expect(css).toMatch(/--surface:\s*#ffffff/i);
    expect(css).toMatch(/--text:\s*#1a1a1a/i);
  });
});
