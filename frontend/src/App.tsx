import { useCallback, useEffect, useState } from "react";
import { ApiError } from "./api/client";
import { buildPackage, getOptions } from "./api/endpoints";
import type { TripOptions, TripRequest } from "./api/types";
import Logo from "./components/Logo";
import Spinner from "./components/Spinner";
import TripForm from "./components/TripForm";

function messageFrom(error: unknown): string {
  if (error instanceof ApiError) {
    const detail = (error.body as { detail?: unknown } | null)?.detail;
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail)) {
      return detail.map((d) => (d as { msg?: string }).msg).filter(Boolean).join(" ");
    }
  }
  return "Something went wrong. Please try again.";
}

export default function App() {
  const [options, setOptions] = useState<TripOptions | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const load = useCallback(() => {
    setLoadFailed(false);
    getOptions().then(setOptions, () => setLoadFailed(true));
  }, []);

  useEffect(load, [load]);

  async function submit(request: TripRequest) {
    setBusy(true);
    setServerError(null);
    try {
      await buildPackage(request);
      setSubmitted(true);
    } catch (error) {
      setServerError(messageFrom(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <header className="app-header">
        <div className="app-header__inner">
          <Logo />
          <span className="app-header__name">Build My Holiday</span>
        </div>
        <div className="hero">
          <h1 className="hero__title">Where to next?</h1>
          <p className="hero__sub">
            One plan with flights, hotels, transfers and things to do. Every part checked to fit together and fit
            your budget.
          </p>
        </div>
      </header>
      <main className="app-main">
        {loadFailed ? (
          <div className="card notice" role="alert">
            <p className="notice__title">We could not load the trip options</p>
            <p className="notice__text">Check that the backend is running, then try again.</p>
            <button type="button" className="btn btn--primary" onClick={load}>
              Try again
            </button>
          </div>
        ) : !options ? (
          <div className="card skeleton">
            <Spinner label="Loading trip options…" showLabel />
            <div className="skeleton__grid" aria-hidden="true">
              {Array.from({ length: 6 }, (_, i) => (
                <div key={i} className="skeleton__field">
                  <span className="skeleton__bar skeleton__bar--label" />
                  <span className="skeleton__bar" />
                </div>
              ))}
            </div>
          </div>
        ) : (
          <>
            <TripForm options={options} onSubmit={submit} busy={busy} serverError={serverError} />
            {submitted && (
              <p className="submitted" role="status">
                Package request submitted.
              </p>
            )}
          </>
        )}
      </main>
    </>
  );
}
