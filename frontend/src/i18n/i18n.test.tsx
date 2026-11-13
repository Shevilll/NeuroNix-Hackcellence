import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { LANGUAGES, languageByCode, speechLocale } from "./languages";
import { I18nProvider, useI18n } from "./I18nProvider";
import LanguageSwitcher from "./LanguageSwitcher";
import { MESSAGES, translate } from "./messages";

const placeholders = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(",");

describe("languages", () => {
  it("offers English and Hindi", () => {
    expect(LANGUAGES.map((l) => l.code)).toEqual(["en", "hi"]);
  });

  it("names every language in its own script and gives a speech locale", () => {
    for (const l of LANGUAGES) {
      expect(l.name.length).toBeGreaterThan(1);
      expect(speechLocale(l.code)).toMatch(/^[a-z]{2,3}-[A-Z]{2}$/);
    }
    expect(speechLocale("hi")).toBe("hi-IN");
    expect(speechLocale("en")).toBe("en-IN");
    expect(languageByCode("zz").code).toBe("en");
  });
});

describe("messages", () => {
  const english = MESSAGES.en;
  const keys = Object.keys(english);

  it("has a translation of every message in every language", () => {
    for (const { code } of LANGUAGES) {
      const missing = keys.filter((k) => !MESSAGES[code]?.[k]);
      expect(missing, `${code} is missing`).toEqual([]);
    }
  });

  it("keeps the {placeholders} of every message in every language", () => {
    for (const { code } of LANGUAGES) {
      for (const k of keys) expect(placeholders(MESSAGES[code][k]), `${code}:${k}`).toBe(placeholders(english[k]));
    }
  });

  it("has no message that is just the English text left in place (except names and numbers)", () => {
    for (const { code } of LANGUAGES.filter((l) => l.code !== "en")) {
      const same = keys.filter((k) => MESSAGES[code][k] === english[k] && /[a-z]{4}/i.test(english[k]) && !k.startsWith("brand"));
      expect(same, `${code} still English`).toEqual([]);
    }
  });

  it("fills {placeholders} and falls back to English for an unknown language or key", () => {
    expect(translate("en", "form.childAge", { n: 2 })).toBe("Age of child 2");
    expect(translate("hi", "form.childAge", { n: 2 })).toContain("2");
    expect(translate("xx", "nav.plan")).toBe("Plan a trip");
    expect(translate("hi", "no.such.key")).toBe("no.such.key");
  });
});

function Probe() {
  const { t, lang } = useI18n();
  return <p data-testid="probe">{lang}:{t("nav.plan")}</p>;
}

describe("provider and switcher", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.lang = "";
  });

  it("starts in English, changes language from the picker and remembers it", async () => {
    render(<I18nProvider><LanguageSwitcher /><Probe /></I18nProvider>);
    expect(screen.getByTestId("probe")).toHaveTextContent("en:Plan a trip");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: /language/i }), "hi");
    expect(screen.getByTestId("probe")).toHaveTextContent(`hi:${MESSAGES.hi["nav.plan"]}`);
    expect(document.documentElement.lang).toBe("hi");
    expect(localStorage.getItem("bmh.lang")).toBe("hi");
  });

  it("restores the saved language on the next visit", () => {
    localStorage.setItem("bmh.lang", "hi");
    render(<I18nProvider><Probe /></I18nProvider>);
    expect(screen.getByTestId("probe")).toHaveTextContent("hi:");
    expect(document.documentElement.lang).toBe("hi");
  });

  it("ignores a saved language it does not know", () => {
    localStorage.setItem("bmh.lang", "klingon");
    render(<I18nProvider><Probe /></I18nProvider>);
    expect(screen.getByTestId("probe")).toHaveTextContent("en:");
  });

  it("works without a provider, in English", () => {
    render(<Probe />);
    expect(screen.getByTestId("probe")).toHaveTextContent("en:Plan a trip");
  });
});
