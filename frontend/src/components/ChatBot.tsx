import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useInRouterContext } from "react-router-dom";
import { askChat, type ChatBlock } from "../api/chat";
import { useI18n } from "../i18n/I18nProvider";
import Icon from "./Icon";
import "./ChatBot.css";

const OPEN_EVENT = "bmh:open-chat";

/** Open the help chat from anywhere on the page (for example the header help button). */
export function openChat() {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

/** The questions offered before the first answer. The backend understands them word for word. */
const STARTERS = ["Hotels in Tokyo", "Things to do in Dubai", "Flights from Delhi to Japan", "How do I cancel a booking?"];

interface Message {
  id: number;
  from: "user" | "bot";
  text: string;
  blocks?: ChatBlock[];
  kind: "ok" | "unknown" | "error";
}

/** Only paths of this site are links; anything else (another site, "//host") is shown as plain text. */
function isSitePath(href: string) {
  return href.startsWith("/") && !href.startsWith("//");
}

/** A link inside the app keeps the chat open; outside a router (tests of the chat alone) it is a plain link. */
function SiteLink({ href, children }: { href: string; children: string }) {
  const inRouter = useInRouterContext();
  return inRouter ? (
    <Link className="chatbot__link" to={href}>
      {children}
    </Link>
  ) : (
    <a className="chatbot__link" href={href}>
      {children}
    </a>
  );
}

/**
 * The answer as clean, structured text: paragraphs, a bullet list with bold names, label and value
 * facts, and links to pages of this site. Without blocks, each line of the plain answer is a paragraph.
 */
function Reply({ text, blocks }: { text: string; blocks?: ChatBlock[] }) {
  const parts: ChatBlock[] = blocks?.length
    ? blocks
    : text.split("\n").filter((line) => line.trim()).map((line) => ({ type: "text" as const, text: line }));
  return (
    <div className="chatbot__text">
      {parts.map((b, i) => {
        if (b.type === "text") return <p key={i} className="chatbot__p">{b.text}</p>;
        if (b.type === "list")
          return (
            <ul key={i} className="chatbot__list">
              {b.items.map((item, j) => (
                <li key={j}>
                  <strong className="chatbot__name">{item.name}</strong>
                  {item.detail && <span className="chatbot__detail">{item.detail}</span>}
                </li>
              ))}
            </ul>
          );
        if (b.type === "facts")
          return (
            <dl key={i} className="chatbot__facts">
              {b.rows.map((row, j) => (
                <div key={j} className="chatbot__fact">
                  <dt>{row.label}</dt>
                  <dd>{row.value}</dd>
                </div>
              ))}
            </dl>
          );
        if (b.type === "link")
          return isSitePath(b.href) ? (
            <p key={i} className="chatbot__p">
              <SiteLink href={b.href}>{b.text}</SiteLink>
            </p>
          ) : null;
        return null;
      })}
    </div>
  );
}

/**
 * Help chat fixed at the bottom right of every page. It sends the question to /api/chat, which
 * answers only from the site's own data with plain rules (no AI). When the data has no answer the
 * backend says so, and the reply is shown as it came, marked as "not found". Nothing is guessed here.
 */
export default function ChatBot() {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>(STARTERS);
  const nextId = useRef(1);
  const input = useRef<HTMLInputElement>(null);
  const launcher = useRef<HTMLButtonElement>(null);
  const log = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);

  useEffect(() => {
    const show = () => {
      setOpen(true);
      input.current?.focus();
    };
    window.addEventListener(OPEN_EVENT, show);
    return () => window.removeEventListener(OPEN_EVENT, show);
  }, []);

  useEffect(() => {
    const el = log.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, busy]);

  function close() {
    setOpen(false);
    launcher.current?.focus();
  }

  function add(from: Message["from"], text: string, kind: Message["kind"] = "ok", blocks?: ChatBlock[]) {
    const id = nextId.current++;
    setMessages((list) => [...list, { id, from, text, kind, blocks }]);
  }

  async function ask(question: string) {
    const text = question.trim();
    if (!text || busy) return;
    add("user", text);
    setDraft("");
    setBusy(true);
    try {
      const reply = await askChat(text);
      add("bot", reply.answer, reply.found ? "ok" : "unknown", reply.blocks);
      if (reply.suggestions.length) setSuggestions(reply.suggestions);
    } catch {
      add("bot", t("chat.error"), "error");
    } finally {
      setBusy(false);
      input.current?.focus();
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void ask(draft);
  }

  return (
    <div className="chatbot chatbot--bottom-right">
      {open && (
        <section
          className="chatbot__panel"
          role="dialog"
          aria-label={t("chat.title")}
          onKeyDown={(e) => {
            if (e.key === "Escape") close();
          }}
        >
          <header className="chatbot__head">
            <span className="chatbot__avatar" aria-hidden="true">
              <Icon name="chat" />
            </span>
            <div className="chatbot__heading">
              <h2 className="chatbot__title">{t("chat.title")}</h2>
              <p className="chatbot__sub">{t("chat.sub")}</p>
            </div>
            <button type="button" className="chatbot__close" onClick={close} aria-label={t("chat.close")}>
              <Icon name="cross" />
            </button>
          </header>

          <div className="chatbot__log" role="log" aria-live="polite" ref={log}>
            <div className="chatbot__msg chatbot__msg--bot">
              <span className="sr-only">{t("chat.bot")}: </span>
              {t("chat.hello")}
            </div>
            {messages.map((m) => (
              <div key={m.id} className={`chatbot__msg chatbot__msg--${m.from}${m.kind !== "ok" ? ` chatbot__msg--${m.kind}` : ""}`}>
                <span className="sr-only">{m.from === "user" ? t("chat.you") : t("chat.bot")}: </span>
                {m.kind === "unknown" && <Icon name="info" className="chatbot__msg-icon" />}
                {m.kind === "error" && <Icon name="warning" className="chatbot__msg-icon" />}
                {m.from === "bot" ? <Reply text={m.text} blocks={m.blocks} /> : <span className="chatbot__text">{m.text}</span>}
              </div>
            ))}
            {busy && (
              <div className="chatbot__msg chatbot__msg--bot chatbot__typing" role="status">
                <span className="chatbot__dots" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </span>
                <span className="sr-only">{t("chat.busy")}</span>
              </div>
            )}
          </div>

          {suggestions.length > 0 && (
            <div className="chatbot__chips" aria-label={t("chat.try")} role="group">
              {suggestions.map((s) => (
                <button key={s} type="button" className="chatbot__chip" onClick={() => void ask(s)} disabled={busy}>
                  {s}
                </button>
              ))}
            </div>
          )}

          <form className="chatbot__form" onSubmit={onSubmit}>
            <label className="sr-only" htmlFor="chatbot-input">
              {t("chat.input")}
            </label>
            <input
              id="chatbot-input"
              ref={input}
              className="chatbot__input"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={t("chat.placeholder")}
              autoComplete="off"
              maxLength={500}
            />
            <button type="submit" className="chatbot__send" disabled={busy || !draft.trim()} aria-label={t("chat.send")}>
              <Icon name="send" />
            </button>
          </form>
        </section>
      )}

      <button
        type="button"
        ref={launcher}
        className={`chatbot__launcher${open ? " chatbot__launcher--open" : ""}`}
        onClick={() => (open ? close() : setOpen(true))}
        aria-label={open ? t("chat.close") : t("chat.open")}
        aria-expanded={open}
      >
        <Icon name={open ? "cross" : "chat"} />
      </button>
    </div>
  );
}
