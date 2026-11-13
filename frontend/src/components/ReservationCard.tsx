import { useState } from "react";
import { Link } from "react-router-dom";
import type { TripPackage } from "../api/endpoints";
import { useI18n } from "../i18n/I18nProvider";
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
  const { t, place, dateRange } = useI18n();
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
        <p className="eyebrow">{t("card.confirmed")}</p>
        <h2 id={`reservation-${number}`}>
          {t("card.reservation")} <span className="reservation__number">{number}</span>
        </h2>
        <p className="muted">
          {pkg.cities?.map(place).join(", ")}
          {pkg.start_date && pkg.end_date ? ` · ${dateRange(pkg.start_date, pkg.end_date)}` : ""}. {t("card.keep")}
        </p>
        <div className="reservation__actions">
          <button type="button" className="btn btn--secondary btn--sm" onClick={copy}>
            <Icon name="copy" /> {copied ? t("card.copied") : t("card.copy")}
          </button>
          {showLink && (
            <Link className="btn btn--primary btn--sm" to={`/r/${number}`}>
              {t("card.openSummary")} <Icon name="arrow" />
            </Link>
          )}
          {showPrint && (
            <button type="button" className="btn btn--secondary btn--sm" onClick={() => window.print?.()}>
              <Icon name="printer" /> {t("card.print")}
            </button>
          )}
          {onDelete && (
            <ConfirmDelete
              label={`${t("card.delete")} ${number}`}
              text={t("card.delete")}
              question={t("card.deleteAsk")}
              confirmText={t("card.deleteYes")}
              busy={deleting}
              onConfirm={onDelete}
            />
          )}
        </div>
      </div>
    </section>
  );
}
