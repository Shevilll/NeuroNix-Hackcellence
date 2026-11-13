import { useEffect, useState } from "react";
import { getCredits, type PhotoCredit } from "../api/endpoints";
import Hero from "../components/Hero";
import Icon from "../components/Icon";
import Spinner from "../components/Spinner";

/** Every photo the app shows, with its author, source and licence (images/ATTRIBUTIONS.md). */
export default function CreditsPage() {
  const [credits, setCredits] = useState<PhotoCredit[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    getCredits().then(
      (list) => live && setCredits(list),
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, []);

  return (
    <>
      <Hero
        title="Photo credits"
        sub="The photos are real, freely licensed images from Wikimedia Commons, resized and otherwise unchanged."
      />
      <main className="page">
        <section className="card credits" aria-label="Photo credits">
          <p className="muted credits__intro">
            Attraction photos show the real place. Hotel photos are generic room photos, because the hotels in the
            data are fictional, so several hotels share one photo.
          </p>
          {failed && (
            <p role="alert" className="inline-error inline-error--box">
              <Icon name="warning" /> We could not load the photo credits. Check that the backend is running.
            </p>
          )}
          {!credits && !failed && <Spinner label="Loading photo credits…" showLabel />}
          {credits && (
            <ul className="credits__list">
              {credits.map((c) => (
                <li key={c.file} className="credit">
                  <img className="credit__thumb" src={`/${c.file}`} alt="" loading="lazy" />
                  <div className="credit__body">
                    <span className="credit__name">{c.used_for}</span>
                    <span className="credit__by">Photo by {c.author}</span>
                    <span className="credit__links">
                      {c.source_url ? (
                        <a href={c.source_url} target="_blank" rel="noreferrer">
                          {c.source_title}
                        </a>
                      ) : (
                        <span>{c.source_title}</span>
                      )}
                      {c.license_url ? (
                        <a className="credit__license" href={c.license_url} target="_blank" rel="noreferrer">
                          {c.license}
                        </a>
                      ) : (
                        <span className="credit__license">{c.license}</span>
                      )}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </>
  );
}
