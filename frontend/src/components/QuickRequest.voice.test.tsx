import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { quickRequest } from "../api/endpoints";
import QuickRequest, { PAUSE_MS } from "./QuickRequest";

vi.mock("../api/endpoints", () => ({ quickRequest: vi.fn() }));
const parse = vi.mocked(quickRequest);

/**
 * A stand-in for the browser's SpeechRecognition in continuous mode. Like Chrome, each session has
 * its own result list: finished phrases plus, at the end, the phrase still being recognised.
 */
class FakeRecognition {
  static last: FakeRecognition | null = null;
  lang = "";
  interimResults = false;
  continuous = false;
  maxAlternatives = 0;
  onresult: ((e: unknown) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  onend: (() => void) | null = null;
  starts = 0;
  private segments: { 0: { transcript: string }; isFinal: boolean; length: number }[] = [];
  start = vi.fn(() => {
    this.starts += 1;
    this.segments = [];
  });
  stop = vi.fn(() => this.onend?.());
  abort = vi.fn(() => this.onend?.());
  constructor() {
    FakeRecognition.last = this;
  }
  private emit(transcript: string, isFinal: boolean) {
    const seg = { 0: { transcript }, isFinal, length: 1 };
    const last = this.segments[this.segments.length - 1];
    if (last && !last.isFinal) this.segments[this.segments.length - 1] = seg;
    else this.segments.push(seg);
    this.onresult?.({ resultIndex: this.segments.length - 1, results: [...this.segments] });
  }
  /** A phrase the browser has finished recognising. */
  hear(transcript: string) {
    this.emit(transcript, true);
  }
  /** The phrase being spoken right now (the browser's running guess). */
  partial(transcript: string) {
    this.emit(transcript, false);
  }
  /** The browser ends the session by itself (as Chrome does now and then). */
  endsByItself() {
    this.onend?.();
  }
  fail(error: string) {
    this.onerror?.({ error });
    this.onend?.();
  }
}

const spoken: string[] = [];
class FakeUtterance {
  lang = "";
  rate = 1;
  voice: unknown = null;
  constructor(public text: string) {}
}

beforeEach(() => {
  spoken.length = 0;
  localStorage.clear();
  FakeRecognition.last = null;
  parse.mockReset();
  vi.stubGlobal("webkitSpeechRecognition", FakeRecognition);
  vi.stubGlobal("SpeechSynthesisUtterance", FakeUtterance);
  vi.stubGlobal("speechSynthesis", {
    speak: vi.fn((u: FakeUtterance) => spoken.push(u.text)),
    cancel: vi.fn(),
    getVoices: () => [],
  });
});
afterEach(() => vi.unstubAllGlobals());

async function speak(transcript: string) {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: /speak your trip/i }));
  act(() => FakeRecognition.last!.hear(transcript));
  await user.click(screen.getByRole("button", { name: /done/i }));
  return user;
}

describe("QuickRequest: voice input", () => {
  it("listens to the whole request, then fills the box once and reads it in one go", async () => {
    parse.mockResolvedValue({ fields: { origin: "BLR", nights: 6 }, missing: [], unclear: [] });
    const onParsed = vi.fn();
    render(<QuickRequest onParsed={onParsed} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /speak your trip/i }));
    const rec = FakeRecognition.last!;
    expect(rec.lang).toBe("en-IN");
    expect(rec.continuous).toBe(true);
    expect(rec.interimResults).toBe(true); // used only to know the traveler is still talking
    expect(screen.getByRole("region", { name: /listening/i })).toHaveTextContent(/listening/i);

    act(() => rec.partial("from Banga"));
    act(() => rec.hear("from Bangalore"));
    act(() => rec.partial("for six"));
    act(() => rec.hear("for six nights"));
    expect(screen.queryByDisplayValue(/Bangalore|Banga|six/)).toBeNull(); // nothing shown word by word
    expect(parse).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /done/i }));
    expect(rec.stop).toHaveBeenCalled();
    await waitFor(() => expect(parse).toHaveBeenCalledTimes(1));
    expect(parse).toHaveBeenCalledWith("from Bangalore for six nights");
    expect(screen.getByLabelText(/describe your trip/i)).toHaveValue("from Bangalore for six nights");
    expect(onParsed).toHaveBeenCalledWith(expect.objectContaining({ fields: { origin: "BLR", nights: 6 } }));
    expect(screen.queryByRole("region", { name: /listening/i })).toBeNull();
  });

  it("does not cut the traveler off in the middle of a long phrase", () => {
    vi.useFakeTimers();
    try {
      parse.mockResolvedValue({ fields: { origin: "BLR" }, missing: [], unclear: [] });
      render(<QuickRequest onParsed={() => {}} />);
      fireEvent.click(screen.getByRole("button", { name: /speak your trip/i }));
      const rec = FakeRecognition.last!;
      act(() => rec.hear("2 adults and a 6 year old from Bangalore"));
      // The next phrase takes the browser 8 seconds to finish, but the traveler keeps talking.
      for (const words of ["to Japan", "to Japan on 10 April", "to Japan on 10 April for 6 nights", "to Japan on 10 April for 6 nights budget 3.5"]) {
        act(() => vi.advanceTimersByTime(2000));
        act(() => rec.partial(words));
      }
      expect(rec.stop).not.toHaveBeenCalled();
      act(() => rec.hear("to Japan on 10 April for 6 nights budget 3.5 lakh"));
      act(() => vi.advanceTimersByTime(PAUSE_MS - 100));
      expect(rec.stop).not.toHaveBeenCalled();
      act(() => vi.advanceTimersByTime(200)); // a real pause: now it finishes
      expect(rec.stop).toHaveBeenCalled();
      expect(parse).toHaveBeenCalledWith("2 adults and a 6 year old from Bangalore to Japan on 10 April for 6 nights budget 3.5 lakh");
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the words still being recognised when Done is pressed", async () => {
    parse.mockResolvedValue({ fields: { origin: "BLR" }, missing: [], unclear: [] });
    render(<QuickRequest onParsed={() => {}} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /speak your trip/i }));
    act(() => FakeRecognition.last!.hear("from Bangalore"));
    act(() => FakeRecognition.last!.partial("to Japan"));
    await user.click(screen.getByRole("button", { name: /done/i }));
    await waitFor(() => expect(parse).toHaveBeenCalledWith("from Bangalore to Japan"));
  });

  it("carries on when the browser ends the session by itself in the middle of a request", async () => {
    parse.mockResolvedValue({ fields: { origin: "BLR" }, missing: [], unclear: [] });
    render(<QuickRequest onParsed={() => {}} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /speak your trip/i }));
    const rec = FakeRecognition.last!;
    act(() => rec.hear("from Bangalore"));
    act(() => rec.endsByItself());
    expect(rec.starts).toBe(2); // listening again, same request
    expect(screen.getByRole("region", { name: /listening/i })).toBeInTheDocument();
    expect(parse).not.toHaveBeenCalled();
    act(() => rec.hear("to Japan for 6 nights"));
    await user.click(screen.getByRole("button", { name: /done/i }));
    await waitFor(() => expect(parse).toHaveBeenCalledWith("from Bangalore to Japan for 6 nights"));
  });

  it("cancel throws away what was heard", async () => {
    render(<QuickRequest onParsed={() => {}} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /speak your trip/i }));
    act(() => FakeRecognition.last!.hear("from Bangalore"));
    await user.click(screen.getByRole("button", { name: /cancel/i }));
    expect(FakeRecognition.last!.abort).toHaveBeenCalled();
    expect(parse).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/describe your trip/i)).toHaveValue("");
    expect(screen.queryByRole("region", { name: /listening/i })).toBeNull();
  });

  it("explains when the browser has no voice input", async () => {
    vi.stubGlobal("webkitSpeechRecognition", undefined);
    render(<QuickRequest onParsed={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: /speak your trip/i }));
    expect(screen.getByRole("status")).toHaveTextContent(/not available in this browser/i);
  });
});

describe("QuickRequest: spoken replies when something goes wrong", () => {
  it("reads out what is still missing after a spoken request", async () => {
    parse.mockResolvedValue({ fields: { origin: "BLR" }, missing: ["budget", "nights"], unclear: [] });
    render(<QuickRequest onParsed={() => {}} />);
    await speak("from Bangalore to Japan");
    await waitFor(() => expect(spoken).toHaveLength(1));
    expect(spoken[0]).toMatch(/budget/);
    expect(spoken[0]).toMatch(/nights/);
    expect(screen.getByRole("status")).toHaveTextContent(/budget/);
  });

  it("reads out a microphone error and shows it", async () => {
    render(<QuickRequest onParsed={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: /speak your trip/i }));
    act(() => FakeRecognition.last!.fail("not-allowed"));
    expect(screen.getByRole("status")).toHaveTextContent(/microphone/i);
    expect(spoken[0]).toMatch(/microphone/i);
  });

  it("reads out when nothing was heard", async () => {
    render(<QuickRequest onParsed={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: /speak your trip/i }));
    act(() => FakeRecognition.last!.fail("no-speech"));
    expect(spoken[0]).toMatch(/did not hear/i);
  });

  it("reads out when the request could not be read", async () => {
    parse.mockRejectedValue(new Error("down"));
    render(<QuickRequest onParsed={() => {}} />);
    await speak("from Bangalore");
    await waitFor(() => expect(spoken[0]).toMatch(/could not read/i));
  });

  it("stays quiet when everything was understood", async () => {
    parse.mockResolvedValue({ fields: { origin: "BLR" }, missing: [], unclear: [] });
    render(<QuickRequest onParsed={() => {}} />);
    await speak("from Bangalore");
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/filled in the form/i));
    expect(spoken).toEqual([]);
  });

  it("never speaks for a typed request", async () => {
    parse.mockResolvedValue({ fields: {}, missing: ["origin"], unclear: [] });
    render(<QuickRequest onParsed={() => {}} />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/describe your trip/i), "hello");
    await user.click(screen.getByRole("button", { name: /fill the form/i }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/could not find/i));
    expect(spoken).toEqual([]);
  });

  it("can be switched off, and remembers the choice", async () => {
    parse.mockResolvedValue({ fields: {}, missing: ["origin"], unclear: [] });
    const { unmount } = render(<QuickRequest onParsed={() => {}} />);
    const toggle = screen.getByRole("checkbox", { name: /read problems aloud/i });
    expect(toggle).toBeChecked();
    await userEvent.click(toggle);
    unmount();

    render(<QuickRequest onParsed={() => {}} />);
    expect(screen.getByRole("checkbox", { name: /read problems aloud/i })).not.toBeChecked();
    await speak("hello");
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/could not find/i));
    expect(spoken).toEqual([]);
  });

  it("reads a Hindi reply with the Hindi voice", async () => {
    const said: { text: string; lang: string; voice: unknown }[] = [];
    const lekha = { lang: "hi-IN", name: "Lekha" };
    vi.stubGlobal("speechSynthesis", {
      speak: vi.fn((u: FakeUtterance) => said.push({ text: u.text, lang: u.lang, voice: u.voice })),
      cancel: vi.fn(),
      getVoices: () => [{ lang: "en-US", name: "Samantha" }, lekha],
    });
    parse.mockResolvedValue({ fields: {}, missing: [], unclear: [], language: "hi" });
    render(<QuickRequest onParsed={() => {}} />);
    await speak("मुझे घूमना है");
    await waitFor(() => expect(said).toHaveLength(1));
    expect(said[0].text).toMatch(/जानकारी नहीं मिली/);
    expect(said[0].lang).toBe("hi-IN");
    expect(said[0].voice).toBe(lekha);
  });

  it("says in writing when the device has no Hindi voice, instead of reading it in English", async () => {
    const synth = {
      speak: vi.fn(),
      cancel: vi.fn(),
      getVoices: () => [{ lang: "en-US", name: "Samantha" }, { lang: "en-IN", name: "Rishi" }],
    };
    vi.stubGlobal("speechSynthesis", synth);
    parse.mockResolvedValue({ fields: {}, missing: [], unclear: [], language: "hi" });
    render(<QuickRequest onParsed={() => {}} />);
    await speak("मुझे घूमना है");
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/जानकारी नहीं मिली/));
    expect(synth.speak).not.toHaveBeenCalled();
    expect(screen.getByText(/no हिन्दी voice/i)).toBeInTheDocument();
  });

  it("hides the spoken-reply option when the browser cannot speak", () => {
    vi.stubGlobal("speechSynthesis", undefined);
    render(<QuickRequest onParsed={() => {}} />);
    expect(screen.queryByRole("checkbox", { name: /read problems aloud/i })).toBeNull();
  });
});
