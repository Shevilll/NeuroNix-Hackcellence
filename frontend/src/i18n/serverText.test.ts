import { describe, expect, it } from "vitest";
import { MESSAGES, translate } from "./messages";
import { SERVER_KEYS, groupName, translateServer } from "./serverText";

const fill = (template: string) => template.replace(/\{(\w+)\}/g, (_, name: string) => `Q${name}Q`);
const sample = (template: string) =>
  Object.fromEntries([...template.matchAll(/\{(\w+)\}/g)].map((m) => [m[1], `Q${m[1]}Q`]));

describe("backend messages in Hindi", () => {
  it("knows every backend message and reads each one back as its own key", () => {
    for (const key of SERVER_KEYS) {
      const english = fill(MESSAGES.en[key]);
      expect(translateServer("hi", english), key).toBe(translate("hi", key, sample(MESSAGES.en[key])));
    }
  });

  it("translates real messages with their cities and dates", () => {
    const text = translateServer("hi", "No flight from Mumbai (BOM) lands in Japan on 3 Apr 2027.");
    expect(text).toContain("मुंबई");
    expect(text).toContain("जापान");
    expect(text).not.toMatch(/No flight|Mumbai|Apr/);
    expect(translateServer("hi", "Stay 4 nights instead of 5: ₹84,120, within your budget.")).toContain("₹84,120");
    expect(translateServer("hi", "12 Apr has no attractions planned.")).not.toMatch(/Apr|attractions/);
  });

  it("leaves English alone, and leaves an unknown message as it came", () => {
    expect(translateServer("en", "Unknown flight.")).toBe("Unknown flight.");
    expect(translateServer("hi", "Something brand new happened")).toBe("Something brand new happened");
  });

  it("names the rule groups", () => {
    expect(groupName("hi", "Flights")).toBe(MESSAGES.hi["g.Flights"]);
    expect(groupName("hi", "Unheard of")).toBe("Unheard of");
  });
});
