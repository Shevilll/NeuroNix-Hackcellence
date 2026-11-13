/**
 * Voice input and spoken replies with the browser's built-in Web Speech API.
 *
 * The app sends no audio anywhere itself and calls no model: the browser turns speech into text
 * (like keyboard dictation) and that text goes to the same rule-based quick-request parser as typing.
 * Spoken replies use the system voices of the browser (speechSynthesis).
 */

interface RecognitionAlternative {
  transcript: string;
}
interface RecognitionResult {
  readonly length: number;
  readonly isFinal: boolean;
  [index: number]: RecognitionAlternative;
}
export interface RecognitionEvent {
  resultIndex: number;
  results: ArrayLike<RecognitionResult>;
}
export interface Recognition {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type RecognitionCtor = new () => Recognition;

/** The browser's speech recogniser (standard or WebKit-prefixed), or null when there is none. */
export function speechRecognition(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function canSpeak(): boolean {
  return typeof window !== "undefined" && !!window.speechSynthesis && typeof window.SpeechSynthesisUtterance === "function";
}

interface VoiceLike {
  lang: string;
}

const normalLocale = (tag: string | undefined) => (tag ?? "").replace(/_/g, "-").toLowerCase();

/**
 * The best voice for a locale: the exact locale first (hi-IN, also written hi_IN on Android), then any
 * voice of the same language. Never a voice of another language: an English voice reading Hindi skips
 * the Devanagari and says only the punctuation.
 */
export function pickVoice<V extends VoiceLike>(voices: readonly V[], locale: string): V | undefined {
  const want = normalLocale(locale);
  const base = want.split("-")[0];
  return (
    voices.find((v) => normalLocale(v.lang) === want) ??
    voices.find((v) => normalLocale(v.lang).split("-")[0] === base)
  );
}

/** How long to wait for the browser's voice list (Chrome fills it a moment after page load). */
const VOICE_WAIT_MS = 1500;
/** Cancels a reply still waiting for voices, so only the latest message is said. */
let pendingReply: (() => void) | null = null;

/**
 * Say a short message aloud in the given locale, replacing anything still being said. A language other
 * than English is only said with a voice of its own: without one the browser falls back to its default
 * English voice, which skips the Devanagari and reads only the punctuation ("comma"). Then nothing is
 * said and `onNoVoice` is called so the page can say so in writing.
 */
export function speak(text: string, locale = "en-IN", onNoVoice?: () => void): void {
  if (!canSpeak()) return;
  const synth = window.speechSynthesis;
  synth.cancel();
  pendingReply?.();
  pendingReply = null;
  const english = normalLocale(locale).startsWith("en");

  const say = () => {
    const voices = synth.getVoices?.() ?? [];
    const voice = pickVoice(voices, locale);
    if (!voice && (voices.length > 0 || !english)) {
      onNoVoice?.();
      return;
    }
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = locale;
    utterance.rate = 1;
    if (voice) utterance.voice = voice;
    synth.speak(utterance);
  };

  if ((synth.getVoices?.() ?? []).length > 0 || typeof synth.addEventListener !== "function") {
    say();
    return;
  }

  // No voices yet: wait for them so a Hindi reply gets a Hindi voice, not the default English one.
  let done = false;
  const finish = (run: boolean) => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    synth.removeEventListener("voiceschanged", onVoices);
    if (pendingReply === cancel) pendingReply = null;
    if (run) say();
  };
  const onVoices = () => finish(true);
  const cancel = () => finish(false);
  const timer = setTimeout(() => finish(true), VOICE_WAIT_MS);
  synth.addEventListener("voiceschanged", onVoices);
  pendingReply = cancel;
}

export function stopSpeaking(): void {
  pendingReply?.();
  pendingReply = null;
  if (canSpeak()) window.speechSynthesis.cancel();
}

/** What to tell the traveler for each recogniser error code. */
export function voiceErrorMessage(code: string): string {
  switch (code) {
    case "not-allowed":
    case "service-not-allowed":
      return "Microphone access is blocked. Allow the microphone for this site, or type your trip instead.";
    case "no-speech":
      return "We did not hear anything. Press the microphone and try again.";
    case "audio-capture":
      return "No microphone was found. Connect one, or type your trip instead.";
    case "network":
      return "Voice input could not reach the browser's speech service. Please type your trip instead.";
    case "language-not-supported":
      return "This browser cannot listen in English here. Please type your trip instead.";
    default:
      return "Voice input stopped. Please try again, or type your trip instead.";
  }
}

const REPLIES_KEY = "bmh.voiceReplies";

/** Whether problems with a spoken request are read aloud. On unless the traveler turned it off. */
export function voiceRepliesOn(): boolean {
  try {
    return localStorage.getItem(REPLIES_KEY) !== "off";
  } catch {
    return true;
  }
}

export function setVoiceReplies(on: boolean): void {
  try {
    localStorage.setItem(REPLIES_KEY, on ? "on" : "off");
  } catch {
    /* storage unavailable: the choice lasts for this page only */
  }
}
