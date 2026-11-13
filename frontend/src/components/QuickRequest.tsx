import { useState } from "react";
import { quickRequest, type QuickResult } from "../api/endpoints";

const LABELS: Record<string, string> = {
  origin: "departure city", country: "destination", start_date: "start date", nights: "nights",
  adults: "adults", budget: "budget", children_ages: "children's ages",
};

export default function QuickRequest({ onParsed }: { onParsed: (r: QuickResult) => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function read() {
    if (!text.trim()) return;
    setBusy(true);
    setNote(null);
    try {
      const result = await quickRequest(text);
      onParsed(result);
      const gaps = [...result.missing, ...result.unclear].map((k) => LABELS[k] ?? k);
      setNote(
        Object.keys(result.fields).length === 0
          ? "We could not find any trip details. Try the form below."
          : gaps.length
            ? `Filled in what we understood. Please add: ${gaps.join(", ")}.`
            : "Filled in the form below. Check it, then build your holiday.",
      );
    } catch {
      setNote("Could not read that request. Please use the form below.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card quick" aria-label="Quick request">
      <label htmlFor="quick-text" className="quick__label">Or just describe your trip</label>
      <div className="quick__row">
        <input
          id="quick-text"
          value={text}
          maxLength={500}
          placeholder="e.g. 2 adults and a 6 year old from Bengaluru to Japan, 10 April, 6 nights, budget 3.5 lakh"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void read(); } }}
        />
        <button type="button" className="btn btn--secondary" onClick={read} disabled={busy || !text.trim()}>
          {busy ? "Reading…" : "Fill the form"}
        </button>
      </div>
      {note && <p role="status" className="quick__note">{note}</p>}
    </section>
  );
}
