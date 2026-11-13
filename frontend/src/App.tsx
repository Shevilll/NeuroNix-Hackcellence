import { useCallback, useEffect, useState } from "react";
import { ApiError } from "./api/client";
import { buildPackage, getOptions } from "./api/endpoints";
import type { TripOptions, TripRequest } from "./api/types";
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
          <span className="app-header__name">Build My Holiday</span>
          <span className="app-header__tag">Flights, hotels, transfers and attractions in one plan</span>
        </div>
      </header>
      <main className="app-main">
        {loadFailed ? (
          <div className="card" role="alert">
            <p>We could not load the trip options. Check that the backend is running.</p>
            <button type="button" className="btn btn--primary" onClick={load}>
              Try again
            </button>
          </div>
        ) : !options ? (
          <p>Loading…</p>
        ) : (
          <>
            <TripForm options={options} onSubmit={submit} busy={busy} serverError={serverError} />
            {submitted && <p>Package request submitted.</p>}
          </>
        )}
      </main>
    </>
  );
}
