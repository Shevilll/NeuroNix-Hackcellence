import { useState } from "react";
import { getCredits, type PhotoCredit } from "../api/endpoints";

export default function PhotoCredits() {
  const [credits, setCredits] = useState<PhotoCredit[] | null>(null);
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next && !credits) getCredits().then(setCredits, () => setFailed(true));
  }

  return (
    <footer className="card credits">
      <button type="button" className="btn" aria-expanded={open} onClick={toggle}>
        Photo credits
      </button>
      {open && (
        <>
          <p className="notice__text">
            Photos are from Wikimedia Commons under public-domain or Creative Commons licenses. Hotel photos are
            generic room photos: the hotels in the data are fictional.
          </p>
          {failed && <p role="alert">Could not load the credits.</p>}
          {credits && (
            <ul className="credits__list">
              {credits.map((c) => (
                <li key={c.file}>
                  <b>{c.used_for}</b> — <a href={c.source_url} target="_blank" rel="noreferrer">{c.source_title}</a> by {c.author},{" "}
                  <a href={c.license_url} target="_blank" rel="noreferrer">{c.license}</a>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </footer>
  );
}
