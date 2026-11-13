import { useEffect, useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { deleteReservation, getReservation, listReservations, type BookingSummary, type TripPackage } from "../api/endpoints";
import BookingsList from "../components/BookingsList";
import Hero from "../components/Hero";
import Icon from "../components/Icon";
import { useI18n } from "../i18n/I18nProvider";
import PackageView from "../components/PackageView";
import ReservationCard from "../components/ReservationCard";
import Spinner from "../components/Spinner";

type State = { kind: "idle" } | { kind: "loading" } | { kind: "missing"; number: string } | { kind: "found"; number: string; pkg: TripPackage };

/** M7: a reservation number opens the summary of the whole package; a wrong number says "not found". */
export default function ReservationPage() {
  const { t } = useI18n();
  const { number } = useParams();
  const navigate = useNavigate();
  const [text, setText] = useState(number ?? "");
  const [formatError, setFormatError] = useState<string | null>(null);
  const [state, setState] = useState<State>({ kind: "idle" });
  const location = useLocation();
  const [bookings, setBookings] = useState<BookingSummary[] | null>(null);
  const [listFailed, setListFailed] = useState(false);
  const [listTry, setListTry] = useState(0);
  const [notice, setNotice] = useState<string | null>((location.state as { notice?: string } | null)?.notice ?? null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // A message handed over by navigate(), e.g. after deleting the booking that was open.
  const handed = (location.state as { notice?: string } | null)?.notice;
  useEffect(() => {
    if (handed) setNotice(handed);
  }, [handed, location.key]);

  // The list of every booking shows when no number is open.
  useEffect(() => {
    if (number) return;
    let live = true;
    setBookings(null);
    setListFailed(false);
    listReservations().then(
      (rows) => live && setBookings(rows),
      () => live && setListFailed(true),
    );
    return () => {
      live = false;
    };
  }, [number, listTry]);

  function deleted(numbers: string[], message: string) {
    setBookings((rows) => (rows ?? []).filter((b) => !numbers.includes(b.reservation_number)));
    setNotice(message);
  }

  async function deleteOpen(n: string) {
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteReservation(n);
      navigate("/r", { state: { notice: t("rv.deleted", { n }) } });
    } catch {
      setDeleteError(t("rv.deleteFail"));
    } finally {
      setDeleting(false);
    }
  }

  useEffect(() => {
    if (!number) {
      setState({ kind: "idle" });
      return;
    }
    let live = true;
    setText(number);
    setState({ kind: "loading" });
    getReservation(number).then(
      (r) => live && setState({ kind: "found", number: r.reservation_number, pkg: r.package }),
      () => live && setState({ kind: "missing", number }),
    );
    return () => {
      live = false;
    };
  }, [number]);

  function open(event: FormEvent) {
    event.preventDefault();
    const n = text.replace(/\s/g, "");
    if (!/^\d{10}$/.test(n)) {
      setFormatError(t("rv.format"));
      return;
    }
    setFormatError(null);
    navigate(`/r/${n}`);
  }

  return (
    <>
      <Hero title={t("rv.title")} sub={t("rv.sub")}>
        <form className="lookup" onSubmit={open} noValidate>
          <label htmlFor="reservation-number" className="sr-only">
            {t("rv.numberLabel")}
          </label>
          <div className="lookup__field">
            <Icon name="search" />
            <input
              id="reservation-number"
              value={text}
              inputMode="numeric"
              autoComplete="off"
              maxLength={12}
              placeholder={t("rv.placeholder")}
              aria-invalid={formatError ? true : undefined}
              aria-describedby={formatError ? "reservation-number-error" : undefined}
              onChange={(e) => setText(e.target.value)}
            />
          </div>
          <button type="submit" className="btn btn--primary">
            {t("c.open")}
          </button>
          {formatError && (
            <p id="reservation-number-error" className="lookup__error">
              {formatError}
            </p>
          )}
        </form>
      </Hero>
      <main className="page">
        {notice && !number && (
          <p role="status" className="page-notice">
            <Icon name="check" /> {notice}
          </p>
        )}
        {state.kind === "idle" && !bookings && !listFailed && (
          <div className="card">
            <Spinner label={t("bk.loading")} showLabel />
          </div>
        )}
        {state.kind === "idle" && listFailed && (
          <div className="card notice" role="alert">
            <p className="notice__text">{t("bk.loadFail")}</p>
            <button type="button" className="btn btn--primary btn--sm" onClick={() => setListTry((n) => n + 1)}>
              {t("load.retry")}
            </button>
          </div>
        )}
        {state.kind === "idle" && bookings && bookings.length > 0 && <BookingsList bookings={bookings} onDeleted={deleted} />}
        {state.kind === "idle" && bookings && bookings.length === 0 && (
          <section className="card lookup-help" aria-labelledby="lookup-help-title">
            <span className="lookup-help__icon">
              <Icon name="file" />
            </span>
            <div>
              <h2 id="lookup-help-title" className="lookup-help__title">
                {t("rv.whereTitle")}
              </h2>
              <p className="muted">
                {t("rv.whereText")}
              </p>
              <Link className="btn btn--secondary btn--sm" to="/">
                <Icon name="home" /> {t("nav.plan")}
              </Link>
            </div>
          </section>
        )}
        {state.kind === "loading" && (
          <div className="card">
            <Spinner label={t("rv.opening")} showLabel />
          </div>
        )}
        {state.kind === "missing" && (
          <div className="card notice" role="alert">
            <p className="notice__title">{t("rv.notFound")}</p>
            <p className="notice__text">
              {t("rv.notFoundText", { n: state.number })}
            </p>
          </div>
        )}
        {state.kind === "found" && (
          <>
            {deleteError && (
              <p role="alert" className="inline-error inline-error--box">
                <Icon name="warning" /> {deleteError}
              </p>
            )}
            <ReservationCard number={state.number} pkg={state.pkg} showPrint onDelete={() => deleteOpen(state.number)} deleting={deleting} />
            <PackageView pkg={state.pkg} budget={state.pkg.budget_inr} eyebrow={t("res.booked")} />
          </>
        )}
      </main>
    </>
  );
}
