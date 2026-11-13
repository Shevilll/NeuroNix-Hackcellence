import { useCallback, useEffect, useRef, useState } from "react";
import { newIdempotencyKey } from "../api/client";
import { build, confirmPackage, getOptions, getPackage, type BuildResult, type TripPackage } from "../api/endpoints";
import type { TripOptions, TripPrefill, TripRequest } from "../api/types";
import Hero from "../components/Hero";
import Icon from "../components/Icon";
import NoPackageNotice from "../components/NoPackageNotice";
import OverBudgetNotice from "../components/OverBudgetNotice";
import PackagePicker, { type PackageChoice } from "../components/PackagePicker";
import PackageView from "../components/PackageView";
import QuickRequest from "../components/QuickRequest";
import ReservationCard from "../components/ReservationCard";
import Spinner from "../components/Spinner";
import TripForm from "../components/TripForm";
import { useI18n } from "../i18n/I18nProvider";
import { messageFrom } from "../lib/errors";

type Ok = Extract<BuildResult, { status: "OK" }>;
type Alternatives = NonNullable<Ok["alternatives"]>;

const STORAGE_KEY = "bmh.planner.v1";

interface Saved {
  request: TripRequest;
  result: Ok;
  pick: string;
  reservation?: { number: string; pkg: TripPackage } | null;
}

/** Packages live in the backend; the browser only remembers which ones were on screen. */
function readSaved(): Saved | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    const saved = raw ? (JSON.parse(raw) as Saved) : null;
    return saved?.result?.status === "OK" && saved.result.package_id && saved.result.package ? saved : null;
  } catch {
    return null;
  }
}

function writeSaved(saved: Saved | null) {
  try {
    if (saved) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* storage can be unavailable (private mode): the page still works, it just will not survive a refresh */
  }
}

function choicesOf(result: Ok, t: (key: string) => string): PackageChoice[] {
  const list: PackageChoice[] = [{ key: "recommended", label: t("pk.recommended"), package_id: result.package_id, package: result.package }];
  for (const [key, alt] of Object.entries(result.alternatives ?? {})) {
    if (alt?.package) list.push({ key, label: t(`pk.${key}`), package_id: alt.package_id, package: alt.package });
  }
  return list;
}

/** Replace one package (after a change, or a refresh from the backend) in the build result. */
function withPackage(result: Ok, key: string, pkg: TripPackage): Ok {
  if (key === "recommended") return { ...result, package: pkg };
  const alternatives = { ...(result.alternatives ?? {}) } as Alternatives;
  const current = alternatives[key as keyof Alternatives];
  if (current) alternatives[key as keyof Alternatives] = { ...current, package: pkg };
  return { ...result, alternatives };
}

export default function PlannerPage() {
  const { t, ts } = useI18n();
  const [saved] = useState(readSaved);
  const [options, setOptions] = useState<TripOptions | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [result, setResult] = useState<BuildResult | null>(saved?.result ?? null);
  const [lastRequest, setLastRequest] = useState<TripRequest | null>(saved?.request ?? null);
  const [prefill, setPrefill] = useState<TripPrefill | null>(saved?.request ?? null);
  const [pick, setPick] = useState(saved?.pick ?? "recommended");
  const [reservation, setReservation] = useState<{ number: string; pkg: TripPackage } | null>(saved?.reservation ?? null);
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [confirmKey] = useState(newIdempotencyKey);
  const resultsRef = useRef<HTMLDivElement>(null);

  const load = useCallback(() => {
    setLoadFailed(false);
    getOptions().then(setOptions, () => setLoadFailed(true));
  }, []);
  useEffect(load, [load]);

  // After a refresh, show the saved packages straight away, then reload their latest versions.
  useEffect(() => {
    if (!saved) return;
    let live = true;
    for (const choice of choicesOf(saved.result, t)) {
      getPackage(choice.package_id).then(
        (pkg) => live && setResult((r) => (r?.status === "OK" ? withPackage(r, choice.key, pkg) : r)),
        () => {
          if (live && choice.key === "recommended") {
            setResult(null);
            setReservation(null);
          }
        },
      );
    }
    return () => {
      live = false;
    };
  }, [saved]);

  useEffect(() => {
    if (result?.status === "OK" && result.package && lastRequest) writeSaved({ request: lastRequest, result, pick, reservation });
    else if (result) writeSaved(null);
  }, [result, lastRequest, pick, reservation]);

  async function submit(request: TripRequest) {
    setBusy(true);
    setServerError(null);
    setConfirmError(null);
    try {
      setLastRequest(request);
      setReservation(null);
      setPick("recommended");
      setResult(await build(request));
      requestAnimationFrame?.(() => resultsRef.current?.scrollIntoView?.({ behavior: "smooth", block: "start" }));
    } catch (error) {
      setServerError(ts(messageFrom(error, undefined, t)));
    } finally {
      setBusy(false);
    }
  }

  /** Run the same request again with other dates or nights, or a bigger budget (from an explanation). */
  function rerun(change: Partial<TripRequest>) {
    if (!lastRequest) return;
    const next = { ...lastRequest, ...change };
    setPrefill(next);
    void submit(next);
  }

  async function confirm(id: string) {
    setConfirming(true);
    setConfirmError(null);
    try {
      const r = await confirmPackage(id, `${confirmKey}:${id}`);
      setReservation({ number: r.reservation_number, pkg: r.package });
      requestAnimationFrame?.(() => resultsRef.current?.scrollIntoView?.({ behavior: "smooth", block: "start" }));
    } catch (error) {
      setConfirmError(ts(messageFrom(error, t("res.confirmFail"), t)));
    } finally {
      setConfirming(false);
    }
  }

  /** Take the package and any booking off the screen (the booking itself stays in the backend). */
  function clearBookings() {
    setResult(null);
    setReservation(null);
    setLastRequest(null);
    setPick("recommended");
    setConfirmError(null);
    writeSaved(null);
  }

  const budget = lastRequest?.budget ?? 0;

  return (
    <>
      <Hero
        title={t("hero.title")}
        sub={t("hero.sub")}
      />
      <main className="page">
        {loadFailed ? (
          <div className="card notice" role="alert">
            <p className="notice__title">{t("load.failTitle")}</p>
            <p className="notice__text">{t("load.failText")}</p>
            <button type="button" className="btn btn--primary" onClick={load}>
              {t("load.retry")}
            </button>
          </div>
        ) : !options ? (
          <div className="card skeleton">
            <Spinner label={t("load.loading")} showLabel />
            <div className="skeleton__grid" aria-hidden="true">
              {Array.from({ length: 8 }, (_, i) => (
                <div key={i} className="skeleton__field">
                  <span className="skeleton__bar skeleton__bar--label" />
                  <span className="skeleton__bar" />
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="planner-form">
            <QuickRequest onParsed={(r) => setPrefill({ ...r.fields })} />
            <TripForm prefill={prefill} options={options} onSubmit={submit} busy={busy} serverError={serverError} />
          </div>
        )}

        <div ref={resultsRef} className="results" aria-live="polite">
          {/* While a build runs, the old result gives way to one loading card. */}
          {busy ? (
            <div className="card">
              <Spinner label={t("plan.building")} showLabel />
            </div>
          ) : (<>
            {result && (
              <button type="button" className="btn btn--secondary btn--sm" onClick={clearBookings}>
                <Icon name="trash" /> {t("res.clear")}
              </button>
            )}
            {result?.status === "NO_PACKAGE" && <NoPackageNotice result={result} onTry={rerun} />}
            {result?.status === "OVER_BUDGET" && (
              <>
                <OverBudgetNotice result={result} onTry={rerun} onRaise={(b) => rerun({ budget: b })} />
                {result.cheapest_package && <PackageView pkg={result.cheapest_package} budget={budget} eyebrow={t("res.cheapestFound")} />}
              </>
            )}
            {result?.status === "OK" && result.package && reservation && (
              <>
                <ReservationCard number={reservation.number} pkg={reservation.pkg} showLink />
                <PackageView pkg={reservation.pkg} budget={reservation.pkg.budget_inr ?? budget} eyebrow={t("res.booked")} />
              </>
            )}
            {result?.status === "OK" && result.package && !reservation && (() => {
              const choices = choicesOf(result, t);
              const current = choices.find((c) => c.key === pick) ?? choices[0];
              return (
                <>
                  {choices.length > 1 && (
                    <div className="results__pick">
                      <h2 className="section-title">{t("res.pick")}</h2>
                      <PackagePicker choices={choices} value={current.key} budget={budget} onPick={setPick} />
                    </div>
                  )}
                  <PackageView
                    key={current.package_id}
                    pkg={current.package}
                    budget={budget}
                    eyebrow={t("res.package", { name: current.label })}
                    edit={{ id: current.package_id, onChanged: (p) => setResult(withPackage(result, current.key, p)) }}
                    actions={
                      <>
                        {confirmError && (
                          <p role="alert" className="inline-error">
                            <Icon name="warning" /> {confirmError}
                          </p>
                        )}
                        <button type="button" className="btn btn--primary btn--block btn--lg" disabled={confirming} onClick={() => confirm(current.package_id)}>
                          {confirming && <Spinner decorative />}
                          {confirming ? t("res.confirming") : t("res.confirm")}
                        </button>
                        <p className="fine-print">{t("res.noPay")}</p>
                      </>
                    }
                  />
                </>
              );
            })()}
          </>)}
        </div>
      </main>
    </>
  );
}
