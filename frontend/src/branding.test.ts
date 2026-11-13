import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("branding", () => {
  it("links an SVG favicon from index.html", () => {
    const html = readFileSync(resolve(root, "index.html"), "utf8");
    expect(html).toMatch(/<link[^>]+rel="icon"[^>]+href="\/favicon\.svg"/);
    expect(existsSync(resolve(root, "public/favicon.svg"))).toBe(true);
  });

  it("favicon uses only the brand blue and white", () => {
    const svg = readFileSync(resolve(root, "public/favicon.svg"), "utf8").toLowerCase();
    const colours = new Set(svg.match(/#[0-9a-f]{3,6}\b/g));
    expect([...colours].sort()).toEqual(["#003b95", "#ffffff"].sort());
  });

  it("sets a theme colour for browser chrome", () => {
    const html = readFileSync(resolve(root, "index.html"), "utf8");
    expect(html).toContain('<meta name="theme-color" content="#003b95"');
  });
});
