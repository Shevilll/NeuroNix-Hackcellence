import { useState } from "react";
import { Link } from "react-router-dom";
import { deleteAllReservations, deleteReservation, type BookingSummary } from "../api/endpoints";
import { useI18n } from "../i18n/I18nProvider";
import { inr } from "../lib/format";
import CityRoute from "./CityRoute";
import ConfirmDelete from "./ConfirmDelete";
import Icon from "./Icon";

interface Props {
  bookings: BookingSummary[];
  /** Called after a delete went through, with the numbers that are gone and a message to show. */
  onDeleted: (numbers: string[], message: string) => void;
}

function travellers(b: BookingSummary, count: (unit: string, n: number) => string) {
  if (b.adults == null) return null;
  return [count("adult", b.adults), b.children ? count("child", b.children) : null]
    .filter(Boolean)
    .join(", ");
}

/** Every booking in the database, each with Open and Delete, and Delete all for a clean demo. */
export default function BookingsList({ bookings, onDeleted }: Props) {
  const { t, count, place, dateRange } = useI18n();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(key: string, action: () => Promise<void>) {
    setBusy(key);
    setError(null);
    try {
      await action();
    } catch {
      setError(t("bk.fail"));
    } finally {
      setBusy(null);
    }
  }

  const removeOne = (number: string) =>
    run(number, async () => {
      await deleteReservation(number);
      onDeleted([number], t("rv.deleted", { n: number }));
    });

  const removeAll = () =>
    run("all", async () => {
      const deletedCount = await deleteAllReservations();
      onDeleted(
        bookings.map((b) => b.reservation_number),
        t(`bk.allDeleted.${deletedCount === 1 ? "one" : "other"}`, { n: deletedCount }),
      );
    });

  return (
    <section className="card bookings" aria-labelledby="bookings-title">
      <div className="bookings__head">
        <h2 id="bookings-title" className="bookings__title">
          {t("bk.title", { n: bookings.length })}
        </h2>
        <ConfirmDelete
          label={t("bk.deleteAllLabel")}
          text={t("bk.deleteAll")}
          question={t("bk.deleteAllAsk", { bookings: count("booking", bookings.length) })}
          confirmText={t("bk.deleteAllYes")}
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
          const who = travellers(b, count);
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
                      <Icon name="pin" /> {place(b.country)}
                    </span>
                  )}
                </span>
              </div>
              <span className="booking__total">{inr(b.total_inr)}</span>
              <div className="booking__actions">
                <Link className="btn btn--secondary btn--sm" to={`/r/${b.reservation_number}`} aria-label={t("bk.openLabel", { n: b.reservation_number })}>
                  {t("c.open")} <Icon name="arrow" />
                </Link>
                <ConfirmDelete
                  label={`${t("card.delete")} ${b.reservation_number}`}
                  text={t("c.delete")}
                  question={t("card.deleteAsk")}
                  confirmText={t("card.deleteYes")}
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
