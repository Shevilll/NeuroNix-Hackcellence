import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { quickRequest } from "../api/endpoints";
import App from "../App";
import QuickRequest from "../components/QuickRequest";
import TripForm from "../components/TripForm";
import { tripOptions, stubApi } from "../test/fixtures";
import { I18nProvider } from "./I18nProvider";
import { MESSAGES } from "./messages";

vi.mock("../api/endpoints", async (importOriginal) => ({ ...(await importOriginal<typeof import("../api/endpoints")>()), quickRequest: vi.fn() }));
const parse = vi.mocked(quickRequest);
const hi = MESSAGES.hi;

beforeEach(() => {
  localStorage.clear();
  parse.mockReset();
  vi.stubGlobal("fetch", vi.fn(stubApi()));
});
afterEach(() => vi.unstubAllGlobals());

describe("the whole app", () => {
  it("has a language picker in the header and switches the navigation and page", async () => {
    render(<App />);
    const picker = screen.getByRole("combobox", { name: /language/i });
    expect(screen.getByRole("link", { name: /plan a trip/i })).toBeInTheDocument();
    await userEvent.selectOptions(picker, "hi");
    expect(screen.getByRole("link", { name: hi["nav.plan"] })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: hi["nav.bookings"] })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent(hi["hero.title"]);
    expect(await screen.findByText(hi["form.title"])).toBeInTheDocument();
    expect(screen.getByText(hi["quick.title"])).toBeInTheDocument();
  });

  it("shows place names in the chosen language in the dropdowns", async () => {
    localStorage.setItem("bmh.lang", "hi");
    render(<App />);
    await userEvent.click(await screen.findByRole("combobox", { name: hi["form.origin"] }));
    expect(screen.getByRole("option", { name: new RegExp(hi["p.Bengaluru"]) })).toBeInTheDocument();
  });
});

describe("the form's messages", () => {
  it("explains mistakes in the chosen language", async () => {
    localStorage.setItem("bmh.lang", "hi");
    render(<I18nProvider><TripForm options={tripOptions} onSubmit={vi.fn()} /></I18nProvider>);
    await userEvent.click(screen.getByRole("button", { name: hi["form.build"] }));
    expect(screen.getByText(hi["err.origin"])).toBeInTheDocument();
    expect(screen.getByText(hi["err.adults"])).toBeInTheDocument();
    expect(screen.getByText(hi["err.budget"])).toBeInTheDocument();
  });

  it("is unchanged in English", async () => {
    render(<TripForm options={tripOptions} onSubmit={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /build my holiday/i }));
    expect(screen.getByText("Choose a departure city.")).toBeInTheDocument();
  });
});

describe("describe your trip in any language", () => {
  const filled = { fields: { origin: "BLR", nights: 6 }, missing: ["budget"], unclear: [] };

  it("answers in the language the request was written in, not the language of the page", async () => {
    parse.mockResolvedValue({ ...filled, language: "hi", supported: true });
    render(<I18nProvider><QuickRequest onParsed={vi.fn()} /></I18nProvider>);
    await userEvent.type(screen.getByLabelText(/describe your trip/i), "चेन्नई से जापान");
    await userEvent.click(screen.getByRole("button", { name: /fill the form/i }));
    const note = await screen.findByRole("status");
    expect(note).toHaveTextContent(hi["quick.partial"].replace("{gaps}", hi["gap.budget"]));
  });

  it("falls back to the page language when the server names none", async () => {
    parse.mockResolvedValue(filled);
    render(<I18nProvider><QuickRequest onParsed={vi.fn()} /></I18nProvider>);
    await userEvent.type(screen.getByLabelText(/describe your trip/i), "hello");
    await userEvent.click(screen.getByRole("button", { name: /fill the form/i }));
    expect(await screen.findByRole("status")).toHaveTextContent(/please add: budget/i);
  });

  it("says so when the language cannot be read", async () => {
    parse.mockResolvedValue({ fields: {}, missing: [], unclear: [], language: "und", supported: false });
    render(<I18nProvider><QuickRequest onParsed={vi.fn()} /></I18nProvider>);
    await userEvent.type(screen.getByLabelText(/describe your trip/i), "東京");
    await userEvent.click(screen.getByRole("button", { name: /fill the form/i }));
    expect(await screen.findByRole("status")).toHaveTextContent(/could not read that language/i);
  });

  it("listens in the page language", async () => {
    class Rec {
      static last: Rec | null = null;
      lang = "";
      onend: (() => void) | null = null;
      start = vi.fn();
      stop = vi.fn();
      abort = vi.fn();
      constructor() { Rec.last = this; }
    }
    vi.stubGlobal("webkitSpeechRecognition", Rec);
    localStorage.setItem("bmh.lang", "hi");
    render(<I18nProvider><QuickRequest onParsed={vi.fn()} /></I18nProvider>);
    await act(async () => { await userEvent.click(screen.getByRole("button", { name: hi["quick.speakAria"] })); });
    await waitFor(() => expect(Rec.last?.lang).toBe("hi-IN"));
  });
});
