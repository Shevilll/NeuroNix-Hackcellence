import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * House rule: the UI uses SVG icons only. No emoji, and none of the symbol characters that browsers
 * draw as emoji or pictograms (check marks, crosses, warning signs, arrows, shapes).
 */
const FORBIDDEN =
  /[\u{1F000}-\u{1FAFF}\u{2190}-\u{21FF}\u{2300}-\u{23FF}\u{25A0}-\u{25FF}\u{2600}-\u{27BF}\u{2900}-\u{297F}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}]/u;

const root = resolve(process.cwd());

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else out.push(path);
  }
  return out;
}

const sources = [
  ...walk(join(root, "src")).filter((f) => /\.(tsx?|css)$/.test(f) && !/\.test\.(tsx?)$/.test(f)),
  join(root, "index.html"),
];

describe("no emoji in the UI", () => {
  it("scans real files", () => {
    expect(sources.length).toBeGreaterThan(10);
  });

  it.each(sources.map((f) => [f.replace(root + "/", ""), f]))("%s has no emoji or pictogram characters", (_name, file) => {
    const lines = readFileSync(file, "utf8").split("\n");
    const bad = lines.map((text, i) => ({ text, line: i + 1 })).filter((l) => FORBIDDEN.test(l.text));
    expect(bad, bad.map((b) => `line ${b.line}: ${b.text.trim()}`).join("\n")).toEqual([]);
  });
});
