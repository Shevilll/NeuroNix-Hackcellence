import { useEffect, useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { deleteReservation, getReservation, listReservations, type BookingSummary, type TripPackage } from "../api/endpoints";
import BookingsList from "../components/BookingsList";
import Hero from "../components/Hero";
import Icon from "../components/Icon";
import PackageView from "../components/PackageView";
import ReservationCard from "../components/ReservationCard";
import Spinner from "../components/Spinner";

type State = { kind: "idle" } | { kind: "loading" } | { kind: "missing"; number: string } | { kind: "found"; number: string; pkg: TripPackage };

/** M7: a reservation number opens the summary of the whole package; a wrong number says "not found". */
export default function ReservationPage() {
  const { number } = useParams();
  const navigate = useNavigate();
  const [text, setText] = useState(number ?? "");
  const [formatError, setFormatError] = useState<string | null>(null);
  const [state, setState] = useState<State>({ kind: "idle" });
  const location = useLocation();
  const [bookings, setBookings] = useState<BookingSummary[] | null>(null);
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
    listReservations().then(
      (rows) => live && setBookings(rows),
      () => live && setBookings([]),
    );
    return () => {
      live = false;
    };
  }, [number]);

  function deleted(numbers: string[], message: string) {
    setBookings((rows) => (rows ?? []).filter((b) => !numbers.includes(b.reservation_number)));
    setNotice(message);
  }

  async function deleteOpen(n: string) {
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteReservation(n);
      navigate("/r", { state: { notice: `Booking ${n} was deleted. Its seats and rooms are free again.` } });
    } catch {
      setDeleteError("We could not delete this booking. Check that the backend is running, then try again.");
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
      setFormatError("A reservation number has exactly 10 digits.");
      return;
    }
    setFormatError(null);
    navigate(`/r/${n}`);
  }

  return (
    <>
      <Hero title="Your bookings" sub="Open a booking with its 10-digit reservation number, or pick one from the list below.">
        <form className="lookup" onSubmit={open} noValidate>
          <label htmlFor="reservation-number" className="sr-only">
            Reservation number
          </label>
          <div className="lookup__field">
            <Icon name="search" />
            <input
              id="reservation-number"
              value={text}
              inputMode="numeric"
              autoComplete="off"
              maxLength={12}
              placeholder="e.g. 4435693622"
              aria-invalid={formatError ? true : undefined}
              aria-describedby={formatError ? "reservation-number-error" : undefined}
              onChange={(e) => setText(e.target.value)}
            />
          </div>
          <button type="submit" className="btn btn--primary">
            Open
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
        {state.kind === "idle" && bookings && bookings.length > 0 && <BookingsList bookings={bookings} onDeleted={deleted} />}
        {state.kind === "idle" && (!bookings || bookings.length === 0) && (
          <section className="card lookup-help" aria-labelledby="lookup-help-title">
            <span className="lookup-help__icon">
              <Icon name="file" />
            </span>
            <div>
              <h2 id="lookup-help-title" className="lookup-help__title">
                Where to find your number
              </h2>
              <p className="muted">
                When you confirm a package you get a 10-digit reservation number. It opens the full day-by-day plan
                at any time, also after the app restarts.
              </p>
              <Link className="btn btn--secondary btn--sm" to="/">
                <Icon name="home" /> Plan a trip
              </Link>
            </div>
          </section>
        )}
        {state.kind === "loading" && (
          <div className="card">
            <Spinner label="Opening your reservation…" showLabel />
          </div>
        )}
        {state.kind === "missing" && (
          <div className="card notice" role="alert">
            <p className="notice__title">Reservation not found</p>
            <p className="notice__text">
              There is no booking with the number {state.number}. Check the 10 digits and try again.
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
            <PackageView pkg={state.pkg} budget={state.pkg.budget_inr} eyebrow="Booked holiday" />
          </>
        )}
      </main>
    </>
  );
}
