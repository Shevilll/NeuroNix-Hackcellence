import { useState } from "react";
import { Link } from "react-router-dom";
import type { TripPackage } from "../api/endpoints";
import { dateRange } from "../lib/format";
import ConfirmDelete from "./ConfirmDelete";
import Icon from "./Icon";

interface Props {
  number: string;
  pkg: TripPackage;
  /** Show a link to the reservation's own page (after confirming). */
  showLink?: boolean;
  /** Show a print button (on the reservation page). */
  showPrint?: boolean;
  /** Show a Delete button that asks first, then calls this. */
  onDelete?: () => void;
  deleting?: boolean;
}

/** The booked state (M7): the 10-digit number, how to reopen it, and copy / print shortcuts. */
export default function ReservationCard({ number, pkg, showLink = false, showPrint = false, onDelete, deleting = false }: Props) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard?.writeText(number);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <section className="card reservation" aria-labelledby={`reservation-${number}`}>
      <span className="reservation__badge">
        <Icon name="check" />
      </span>
      <div className="reservation__body">
        <p className="eyebrow">Booking confirmed</p>
        <h2 id={`reservation-${number}`}>
          Reservation <span className="reservation__number">{number}</span>
        </h2>
        <p className="muted">
          {pkg.cities?.join(", ")}
          {pkg.start_date && pkg.end_date ? ` · ${dateRange(pkg.start_date, pkg.end_date)}` : ""}. Keep this number: it
          opens the full summary at any time, also after a restart.
        </p>
        <div className="reservation__actions">
          <button type="button" className="btn btn--secondary btn--sm" onClick={copy}>
            <Icon name="copy" /> {copied ? "Copied" : "Copy number"}
          </button>
          {showLink && (
            <Link className="btn btn--primary btn--sm" to={`/r/${number}`}>
              Open the summary page <Icon name="arrow" />
            </Link>
          )}
          {showPrint && (
            <button type="button" className="btn btn--secondary btn--sm" onClick={() => window.print?.()}>
              <Icon name="printer" /> Print
            </button>
          )}
          {onDelete && (
            <ConfirmDelete
              label={`Delete booking ${number}`}
              text="Delete booking"
              question="Delete this booking? It gives its seats and rooms back and cannot be undone."
              confirmText="Yes, delete"
              busy={deleting}
              onConfirm={onDelete}
            />
          )}
        </div>
      </div>
    </section>
  );
}
