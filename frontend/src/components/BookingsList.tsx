import { useState } from "react";
import { Link } from "react-router-dom";
import { deleteAllReservations, deleteReservation, type BookingSummary } from "../api/endpoints";
import { dateRange, inr, plural } from "../lib/format";
import CityRoute from "./CityRoute";
import ConfirmDelete from "./ConfirmDelete";
import Icon from "./Icon";

interface Props {
  bookings: BookingSummary[];
  /** Called after a delete went through, with the numbers that are gone and a message to show. */
  onDeleted: (numbers: string[], message: string) => void;
}

function travellers(b: BookingSummary) {
  if (b.adults == null) return null;
  return [plural(b.adults, "adult"), b.children ? (b.children === 1 ? "1 child" : `${b.children} children`) : null]
    .filter(Boolean)
    .join(", ");
}

/** Every booking in the database, each with Open and Delete, and Delete all for a clean demo. */
export default function BookingsList({ bookings, onDeleted }: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(key: string, action: () => Promise<void>) {
    setBusy(key);
    setError(null);
    try {
      await action();
    } catch {
      setError("We could not delete that. Check that the backend is running, then try again.");
    } finally {
      setBusy(null);
    }
  }

  const removeOne = (number: string) =>
    run(number, async () => {
      await deleteReservation(number);
      onDeleted([number], `Booking ${number} was deleted. Its seats and rooms are free again.`);
    });

  const removeAll = () =>
    run("all", async () => {
      const count = await deleteAllReservations();
      onDeleted(
        bookings.map((b) => b.reservation_number),
        `${plural(count, "booking")} ${count === 1 ? "was" : "were"} deleted. Every seat and room is free again.`,
      );
    });

  return (
    <section className="card bookings" aria-labelledby="bookings-title">
      <div className="bookings__head">
        <h2 id="bookings-title" className="bookings__title">
          All bookings ({bookings.length})
        </h2>
        <ConfirmDelete
          label="Delete all bookings"
          text="Delete all"
          question={`Delete all ${plural(bookings.length, "booking")}? Every seat and room goes back. This cannot be undone.`}
          confirmText="Yes, delete all"
          busy={busy === "all"}
          onConfirm={removeAll}
        />
      </div>
      {error && (
        <p role="alert" className="inline-error inline-error--box">
          <Icon name="warning" /> {error}
        </p>
      )}
      <ul className="bookings__list">
        {bookings.map((b) => {
          const who = travellers(b);
          return (
            <li key={b.reservation_number} className="booking">
              <div className="booking__main">
                <span className="booking__number">{b.reservation_number}</span>
                <span className="booking__route">
                  <CityRoute cities={b.cities} nights={b.nights_per_city} />
                </span>
                <span className="booking__meta">
                  {b.start_date && b.end_date && (
                    <span>
                      <Icon name="calendar" /> {dateRange(b.start_date, b.end_date)}
                    </span>
                  )}
                  {who && (
                    <span>
                      <Icon name="users" /> {who}
                    </span>
                  )}
                  {b.country && (
                    <span>
                      <Icon name="pin" /> {b.country}
                    </span>
                  )}
                </span>
              </div>
              <span className="booking__total">{inr(b.total_inr)}</span>
              <div className="booking__actions">
                <Link className="btn btn--secondary btn--sm" to={`/r/${b.reservation_number}`} aria-label={`Open booking ${b.reservation_number}`}>
                  Open <Icon name="arrow" />
                </Link>
                <ConfirmDelete
                  label={`Delete booking ${b.reservation_number}`}
                  text="Delete"
                  question="Delete this booking? It gives its seats and rooms back and cannot be undone."
                  confirmText="Yes, delete"
                  busy={busy === b.reservation_number}
                  onConfirm={() => removeOne(b.reservation_number)}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
