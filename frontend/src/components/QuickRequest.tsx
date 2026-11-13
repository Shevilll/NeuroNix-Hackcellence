import { useEffect, useRef, useState } from "react";
import { quickRequest, type QuickResult } from "../api/endpoints";
import { useI18n } from "../i18n/I18nProvider";
import { isSupported, speechLocale } from "../i18n/languages";
import { canSpeak, setVoiceReplies, speak, speechRecognition, stopSpeaking, voiceRepliesOn, type Recognition } from "../lib/speech";
import Icon from "./Icon";
import Spinner from "./Spinner";

/** Which message says each recogniser error. */
const VOICE_KEYS: Record<string, string> = {
  "not-allowed": "voice.blocked", "service-not-allowed": "voice.blocked", "no-speech": "voice.noSpeech",
  "audio-capture": "voice.noMic", network: "voice.network", "language-not-supported": "voice.language",
};

/** Listening ends after this much silence (time since the browser last heard any speech). */
export const PAUSE_MS = 3000;
/** Chrome sometimes ends a listening session by itself; we carry on for up to this long in total. */
const MAX_LISTEN_MS = 90_000;
const MAX_RESTARTS = 10;

interface Note {
  text: string;
  /** A problem the traveler has to act on (read aloud after a spoken request). */
  problem: boolean;
}

export default function QuickRequest({ onParsed }: { onParsed: (r: QuickResult) => void }) {
  const { t, tIn, lang } = useI18n();
  const voiceMessage = (code: string) => t(VOICE_KEYS[code] ?? "voice.stopped");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<Note | null>(null);
  const [listening, setListening] = useState(false);
  const [replies, setReplies] = useState(voiceRepliesOn);
  const repliesOn = useRef(replies);
  const [speechOut] = useState(canSpeak);
  const [heardSomething, setHeardSomething] = useState(false);
  const recognition = useRef<Recognition | null>(null);
  /** Words from earlier sessions of this request (when the browser restarted listening). */
  const committed = useRef("");
  /** Words of the current session: finished phrases plus the phrase still being recognised. */
  const heard = useRef("");
  const stopRequested = useRef(false);
  const startedAt = useRef(0);
  const restarts = useRef(0);
  const failed = useRef(false);
  const cancelled = useRef(false);
  const pause = useRef<ReturnType<typeof setTimeout> | null>(null);

  function clearPause() {
    if (pause.current) clearTimeout(pause.current);
    pause.current = null;
  }

  useEffect(() => () => {
    clearPause();
    cancelled.current = true;
    recognition.current?.abort();
    stopSpeaking();
  }, []);

  /** Show a message; after a spoken request, also say it aloud when it is a problem. */
  function tell(next: Note, viaVoice: boolean, replyLang = lang) {
    setNote(next);
    if (viaVoice && next.problem && repliesOn.current && speechOut) speak(next.text, speechLocale(replyLang));
  }

  async function read(request = text, viaVoice = false) {
    if (!request.trim()) return;
    setBusy(true);
    setNote(null);
    try {
      const result = await quickRequest(request);
      onParsed(result);
      // Answer in the language the traveler wrote in; the page language when we could not tell.
      const replyLang = isSupported(result.language) ? result.language : lang;
      const say = (key: string, vars?: Record<string, string | number>) => tIn(replyLang, key, vars);
      const gapLabel = (k: string) => (say(`gap.${k}`) === `gap.${k}` ? k : say(`gap.${k}`));
      const gaps = [...result.missing, ...result.unclear].map(gapLabel);
      if (result.supported === false) {
        tell({ text: t("quick.unsupported"), problem: true }, viaVoice);
      } else if (Object.keys(result.fields).length === 0) {
        tell({ text: say("quick.none"), problem: true }, viaVoice, replyLang);
      } else if (gaps.length) {
        tell({ text: say("quick.partial", { gaps: gaps.join(", ") }), problem: true }, viaVoice, replyLang);
      } else {
        tell({ text: say("quick.full"), problem: false }, viaVoice, replyLang);
      }
    } catch {
      tell({ text: t("quick.failed"), problem: true }, viaVoice);
    } finally {
      setBusy(false);
    }
  }

  /** Everything said so far in this request. */
  function transcript() {
    return `${committed.current} ${heard.current}`.replace(/\s+/g, " ").trim();
  }

  /** Restart the silence countdown: called whenever the browser hears speech. */
  function stillTalking() {
    clearPause();
    pause.current = setTimeout(() => {
      stopRequested.current = true;
      recognition.current?.stop();
    }, PAUSE_MS);
  }

  /**
   * Start listening. Nothing is shown while the traveler talks; when they finish (Done, or a real
   * pause), the whole request goes into the box at once and is read in one pass.
   *
   * The browser's running guesses (interim results) are requested only to know that the traveler is
   * still talking. Without them the browser reports nothing until a phrase is complete, which can
   * take several seconds, and the silence timer would cut the traveler off mid-sentence.
   */
  function listen() {
    const Ctor = speechRecognition();
    if (!Ctor) {
      setNote({ text: t("quick.noVoice"), problem: true });
      return;
    }
    stopSpeaking();
    const rec = new Ctor();
    rec.lang = speechLocale(lang);
    rec.continuous = true; // keep listening across short pauses between phrases
    rec.interimResults = true; // only to notice ongoing speech; never shown
    rec.maxAlternatives = 1;
    committed.current = "";
    heard.current = "";
    stopRequested.current = false;
    failed.current = false;
    cancelled.current = false;
    startedAt.current = Date.now();
    restarts.current = 0;

    rec.onresult = (event) => {
      const phrases: string[] = [];
      for (let i = 0; i < event.results.length; i++) phrases.push(event.results[i][0]?.transcript ?? "");
      heard.current = phrases.join(" ");
      setHeardSomething(transcript().length > 0);
      stillTalking();
    };
    rec.onerror = (event) => {
      // "aborted": the traveler cancelled (or the page closed). "no-speech" after some words were
      // heard just means they stopped talking: finish normally with what was said.
      if (event.error === "aborted" || cancelled.current) return;
      if (event.error === "no-speech" && transcript()) {
        stopRequested.current = true;
        return;
      }
      failed.current = true;
      tell({ text: voiceMessage(event.error), problem: true }, true);
    };
    rec.onend = () => {
      committed.current = transcript();
      heard.current = "";
      const finished = stopRequested.current || cancelled.current || failed.current;
      if (!finished && Date.now() - startedAt.current < MAX_LISTEN_MS && restarts.current < MAX_RESTARTS) {
        restarts.current += 1;
        // The browser ended the session by itself: keep listening for the same request.
        try {
          rec.start();
          return;
        } catch {
          /* could not restart: finish with what we have */
        }
      }
      clearPause();
      setListening(false);
      setHeardSomething(false);
      recognition.current = null;
      if (cancelled.current || failed.current) return;
      const said = committed.current;
      if (said) {
        setText(said);
        void read(said, true);
      } else {
        tell({ text: voiceMessage("no-speech"), problem: true }, true);
      }
    };
    recognition.current = rec;
    setNote(null);
    setListening(true);
    try {
      rec.start();
    } catch {
      setListening(false);
      recognition.current = null;
      tell({ text: voiceMessage("start"), problem: true }, true);
    }
  }

  /** Finish now and read everything that was said. */
  function done() {
    clearPause();
    stopRequested.current = true;
    recognition.current?.stop();
  }

  /** Stop and forget what was said. */
  function cancel() {
    clearPause();
    cancelled.current = true;
    committed.current = "";
    heard.current = "";
    recognition.current?.abort();
  }

  function toggleReplies(on: boolean) {
    setReplies(on);
    repliesOn.current = on;
    setVoiceReplies(on);
    if (!on) stopSpeaking();
  }

  return (
    <section className="card quick" aria-label={t("quick.aria")}>
      <label htmlFor="quick-text" className="quick__label">{t("quick.title")}</label>
      <div
        className={`quick__row${listening ? " quick__row--listening" : ""}`}
        role={listening ? "region" : undefined}
        aria-label={listening ? t("quick.listenAria") : undefined}
      >
        <div className="quick__field">
          <input
            id="quick-text"
            value={listening ? "" : text}
            maxLength={500}
            readOnly={listening}
            placeholder={
              listening
                ? heardSomething ? t("quick.heard") : t("quick.listening")
                : t("quick.placeholder")
            }
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !listening) { e.preventDefault(); void read(); } }}
          />
          {listening && (
            <span className={`quick__wave${heardSomething ? " quick__wave--heard" : ""}`} aria-hidden="true">
              <i /><i /><i /><i /><i />
            </span>
          )}
          {listening && <span className="sr-only">{t("quick.listenSr")}</span>}
        </div>
        {listening ? (
          <>
            <button type="button" className="btn btn--primary quick__speak quick__speak--on" onClick={done}>
              <Icon name="check" /> <span>{t("quick.done")}</span>
            </button>
            <button type="button" className="btn btn--ghost" onClick={cancel}>
              {t("quick.cancel")}
            </button>
          </>
        ) : (
          <>
            <button type="button" className="btn btn--secondary quick__speak" aria-label={t("quick.speakAria")} disabled={busy} onClick={listen}>
              <Icon name="mic" /> <span>{t("quick.speak")}</span>
            </button>
            <button type="button" className="btn btn--primary" onClick={() => void read()} disabled={busy || !text.trim()}>
              {busy && <Spinner decorative />}
              {busy ? t("quick.reading") : t("quick.fill")}
            </button>
          </>
        )}
      </div>
      <div className="quick__foot">
        {listening ? (
          <p className="quick__note">
            <Icon name="mic" />
            {t("quick.listenHint")}
          </p>
        ) : note ? (
          <p role="status" className={`quick__note${note.problem ? " quick__note--problem" : ""}`}>
            {note.problem && <Icon name="info" />}
            {note.text}
          </p>
        ) : (
          <p className="quick__note">{t("quick.hint")}</p>
        )}
        {speechOut && (
          <label className="quick__replies">
            <input type="checkbox" checked={replies} onChange={(e) => toggleReplies(e.target.checked)} />
            <Icon name="speaker" />
            {t("quick.readAloud")}
          </label>
        )}
      </div>
    </section>
  );
}
