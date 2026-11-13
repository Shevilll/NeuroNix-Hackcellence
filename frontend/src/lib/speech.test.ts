import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pickVoice, speak } from "./speech";

class FakeUtterance {
  lang = "";
  rate = 1;
  voice: unknown = null;
  constructor(public text: string) {}
}

type Voice = { lang: string; name: string };
const english: Voice = { lang: "en-US", name: "Samantha" };
const indianEnglish: Voice = { lang: "en-IN", name: "Rishi" };
const hindi: Voice = { lang: "hi-IN", name: "Lekha" };

function fakeSynth(initial: Voice[]) {
  let voices = initial;
  const listeners: Array<() => void> = [];
  const synth = {
    speak: vi.fn(),
    cancel: vi.fn(),
    getVoices: () => voices,
    addEventListener: (type: string, fn: () => void) => {
      if (type === "voiceschanged") listeners.push(fn);
    },
    removeEventListener: (type: string, fn: () => void) => {
      const i = listeners.indexOf(fn);
      if (type === "voiceschanged" && i >= 0) listeners.splice(i, 1);
    },
    /** What Chrome does a moment after page load: the voice list arrives. */
    loadVoices(next: Voice[]) {
      voices = next;
      [...listeners].forEach((fn) => fn());
    },
  };
  return synth;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("SpeechSynthesisUtterance", FakeUtterance);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("pickVoice", () => {
  it("picks the exact locale first", () => {
    expect(pickVoice([english, hindi], "hi-IN")).toBe(hindi);
  });

  it("matches Android-style hi_IN and any case", () => {
    const android = { lang: "hi_in", name: "Hindi" };
    expect(pickVoice([english, android], "hi-IN")).toBe(android);
  });

  it("falls back to any voice of the same language", () => {
    const plainHindi = { lang: "hi", name: "Hindi" };
    expect(pickVoice([english, plainHindi], "hi-IN")).toBe(plainHindi);
  });

  it("never gives an English voice for Hindi", () => {
    expect(pickVoice([english, indianEnglish], "hi-IN")).toBeUndefined();
  });
});

describe("speak", () => {
  it("says Hindi text with a Hindi voice when voices are ready", () => {
    const synth = fakeSynth([english, hindi]);
    vi.stubGlobal("speechSynthesis", synth);
    speak("कृपया जोड़ें: तारीख, बजट।", "hi-IN");
    expect(synth.speak).toHaveBeenCalledTimes(1);
    const said = synth.speak.mock.calls[0][0] as FakeUtterance;
    expect(said.lang).toBe("hi-IN");
    expect(said.voice).toBe(hindi);
    expect(said.text).toBe("कृपया जोड़ें: तारीख, बजट।");
  });

  it("waits for the voice list to load, then speaks Hindi with the Hindi voice", () => {
    const synth = fakeSynth([]);
    vi.stubGlobal("speechSynthesis", synth);
    speak("हमें कुछ सुनाई नहीं दिया।", "hi-IN");
    expect(synth.speak).not.toHaveBeenCalled();
    synth.loadVoices([english, hindi]);
    expect(synth.speak).toHaveBeenCalledTimes(1);
    expect((synth.speak.mock.calls[0][0] as FakeUtterance).voice).toBe(hindi);
  });

  it("still speaks English (by locale only) if the voice list never arrives", () => {
    const synth = fakeSynth([]);
    vi.stubGlobal("speechSynthesis", synth);
    speak("We did not hear anything.");
    vi.advanceTimersByTime(2000);
    expect(synth.speak).toHaveBeenCalledTimes(1);
    expect((synth.speak.mock.calls[0][0] as FakeUtterance).lang).toBe("en-IN");
  });

  it("does not speak Hindi when the browser never lists any voice, and says so", () => {
    const synth = fakeSynth([]);
    vi.stubGlobal("speechSynthesis", synth);
    const noVoice = vi.fn();
    speak("फिर कोशिश करें, या लिखें।", "hi-IN", noVoice);
    vi.advanceTimersByTime(2000);
    expect(synth.speak).not.toHaveBeenCalled();
    expect(noVoice).toHaveBeenCalledTimes(1);
  });

  it("does not speak Hindi in a browser without voice events and with no voices", () => {
    const synth = { speak: vi.fn(), cancel: vi.fn(), getVoices: () => [] };
    vi.stubGlobal("speechSynthesis", synth);
    const noVoice = vi.fn();
    speak("फिर कोशिश करें, या लिखें।", "hi-IN", noVoice);
    expect(synth.speak).not.toHaveBeenCalled();
    expect(noVoice).toHaveBeenCalledTimes(1);
  });

  it("only the latest message is said when a second one comes while waiting", () => {
    const synth = fakeSynth([]);
    vi.stubGlobal("speechSynthesis", synth);
    speak("पहला", "hi-IN");
    speak("दूसरा", "hi-IN");
    synth.loadVoices([hindi]);
    vi.advanceTimersByTime(2000);
    expect(synth.speak).toHaveBeenCalledTimes(1);
    expect((synth.speak.mock.calls[0][0] as FakeUtterance).text).toBe("दूसरा");
  });

  it("does not read Hindi with an English voice when the device has no Hindi voice", () => {
    const synth = fakeSynth([english, indianEnglish]);
    vi.stubGlobal("speechSynthesis", synth);
    const noVoice = vi.fn();
    speak("फिर कोशिश करें, या लिखें।", "hi-IN", noVoice);
    expect(synth.speak).not.toHaveBeenCalled();
    expect(noVoice).toHaveBeenCalledTimes(1);
  });

  it("reports a missing Hindi voice after the voice list loads too", () => {
    const synth = fakeSynth([]);
    vi.stubGlobal("speechSynthesis", synth);
    const noVoice = vi.fn();
    speak("फिर कोशिश करें, या लिखें।", "hi-IN", noVoice);
    synth.loadVoices([english]);
    expect(synth.speak).not.toHaveBeenCalled();
    expect(noVoice).toHaveBeenCalledTimes(1);
  });

  it("keeps English working with an Indian English voice", () => {
    const synth = fakeSynth([english, indianEnglish, hindi]);
    vi.stubGlobal("speechSynthesis", synth);
    speak("We did not hear anything.");
    const said = synth.speak.mock.calls[0][0] as FakeUtterance;
    expect(said.lang).toBe("en-IN");
    expect(said.voice).toBe(indianEnglish);
  });
});
