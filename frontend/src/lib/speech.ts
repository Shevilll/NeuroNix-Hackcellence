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

/** Say a short message aloud, replacing anything still being said. Prefers an Indian English voice. */
export function speak(text: string, locale = "en-IN"): void {
  if (!canSpeak()) return;
  const synth = window.speechSynthesis;
  synth.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = locale;
  utterance.rate = 1;
  const voices = synth.getVoices?.() ?? [];
  const voice = voices.find((v) => v.lang === locale) ?? voices.find((v) => v.lang?.startsWith(locale.slice(0, 2)));
  if (voice) utterance.voice = voice;
  synth.speak(utterance);
}

export function stopSpeaking(): void {
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
