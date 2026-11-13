import { useCallback, useEffect, useState } from "react";
import { ApiError } from "./api/client";
import { build, confirmPackage, getOptions, getReservation, type BuildResult, type TripPackage } from "./api/endpoints";
import { newIdempotencyKey } from "./api/client";
import ChangePanel from "./components/ChangePanel";
import QuickRequest from "./components/QuickRequest";
import CheckerPanel from "./components/CheckerPanel";
import PhotoCredits from "./components/PhotoCredits";
import PackageView from "./components/PackageView";
import type { TripOptions, TripRequest } from "./api/types";
import Logo from "./components/Logo";
import Spinner from "./components/Spinner";
import TripForm from "./components/TripForm";

function messageFrom(error: unknown): string {
  if (error instanceof ApiError) {
    const detail = (error.body as { detail?: unknown } | null)?.detail;
    if (typeof detail === "string") return detail;
    if (detail && typeof detail === "object" && typeof (detail as { message?: unknown }).message === "string") {
      return (detail as { message: string }).message;
    }
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
  const [result, setResult] = useState<BuildResult | null>(null);
  const [budget, setBudget] = useState(0);
  const [reservation, setReservation] = useState<{ number: string; pkg: TripPackage } | null>(null);
  const [pick, setPick] = useState<string>("recommended");
  const [prefill, setPrefill] = useState<Partial<TripRequest> | null>(null);
  const [lookup, setLookup] = useState("");
  const [notFound, setNotFound] = useState(false);
  const [confirmKey] = useState(newIdempotencyKey);

  async function confirm(id: string) {
    setBusy(true);
    try {
      const r = await confirmPackage(id, confirmKey);
      setReservation({ number: r.reservation_number, pkg: r.package });
    } catch (error) {
      setServerError(messageFrom(error));
    } finally {
      setBusy(false);
    }
  }

  async function open(number: string) {
    setNotFound(false);
    try {
      const r = await getReservation(number);
      setReservation({ number: r.reservation_number, pkg: r.package });
    } catch {
      setNotFound(true);
    }
  }

  const load = useCallback(() => {
    setLoadFailed(false);
    getOptions().then(setOptions, () => setLoadFailed(true));
  }, []);

  useEffect(load, [load]);

  async function submit(request: TripRequest) {
    setBusy(true);
    setServerError(null);
    try {
      setBudget(request.budget);
      setReservation(null);
      setPick("recommended");
      setResult(await build(request));
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
            <QuickRequest onParsed={(r) => setPrefill({ ...r.fields })} />
            <TripForm prefill={prefill} options={options} onSubmit={submit} busy={busy} serverError={serverError} />
            {result?.status === "NO_PACKAGE" && (
              <div className="card notice" role="alert">
                <p className="notice__title">No package is possible</p>
                {result.reasons.map((r) => <p key={r.code} className="notice__text">{r.message}</p>)}
              </div>
            )}
            {result?.status === "OVER_BUDGET" && (
              <>
                <div className="card notice" role="alert">
                  <p className="notice__title">Over budget</p>
                  <p className="notice__text">
                    The cheapest package costs ₹{result.cheapest_total.toLocaleString("en-IN")}, which is ₹
                    {result.short_by.toLocaleString("en-IN")} more than your budget.
                  </p>
                  {result.suggestions.map((t) => <p key={t} className="notice__text">{t}</p>)}
                </div>
                <PackageView pkg={result.cheapest_package} budget={budget} />
              </>
            )}
            {result?.status === "OK" && result.package && !reservation && (() => {
              const choices: Record<string, { package_id: string; package: TripPackage }> = {
                recommended: { package_id: result.package_id, package: result.package },
                ...(result.alternatives ?? {}),
              };
              const labels: Record<string, string> = {
                recommended: "Recommended", cheapest: "Cheapest", fastest: "Fastest", best_rated: "Best rated",
              };
              const current = choices[pick] ?? choices.recommended;
              const setCurrent = (p: TripPackage) => {
                if (pick === "recommended") setResult({ ...result, package: p });
                else setResult({ ...result, alternatives: { ...result.alternatives!, [pick]: { ...current, package: p } } } as BuildResult);
              };
              return (
                <>
                  <div className="tabs" role="tablist" aria-label="Package choices">
                    {Object.keys(choices).map((k) => (
                      <button key={k} type="button" role="tab" aria-selected={pick === k}
                        className={pick === k ? "btn btn--primary" : "btn"} onClick={() => setPick(k)}>
                        {labels[k]}
                      </button>
                    ))}
                  </div>
                  <PackageView pkg={current.package} budget={budget} />
                  <ChangePanel id={current.package_id} pkg={current.package} onChanged={setCurrent} />
                  <button type="button" className="btn btn--primary" disabled={busy} onClick={() => confirm(current.package_id)}>
                    {busy ? "Confirming…" : "Confirm booking"}
                  </button>
                </>
              );
            })()}
            {reservation && (
              <>
                <div className="card notice" role="status">
                  <p className="notice__title">Reservation {reservation.number}</p>
                  <p className="notice__text">Your holiday is booked. Keep this number to reopen the summary.</p>
                </div>
                <PackageView pkg={reservation.pkg} budget={reservation.pkg.budget_inr} />
              </>
            )}
            <CheckerPanel />
            <form className="card lookup" onSubmit={(e) => { e.preventDefault(); open(lookup.trim()); }}>
              <label>Have a reservation number? <input value={lookup} onChange={(e) => setLookup(e.target.value)} inputMode="numeric" maxLength={10} /></label>
              <button type="submit" className="btn">Open</button>
              {notFound && <p role="alert">Reservation not found.</p>}
            </form>
          </>
        )}
      </main>
      <div className="app-main app-main--footer"><PhotoCredits /></div>
    </>
  );
}
