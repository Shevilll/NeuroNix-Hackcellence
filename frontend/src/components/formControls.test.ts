import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolve(process.cwd(), "src/components/TripForm.css"), "utf8");

describe("form control styling", () => {
  it("hides the browser's number spinner arrows in every browser", () => {
    expect(css).toMatch(/input\[type="number"\]::-webkit-inner-spin-button[\s\S]*?-webkit-appearance:\s*none/);
    expect(css).toMatch(/input\[type="number"\][\s\S]*?-moz-appearance:\s*textfield/);
  });
});
