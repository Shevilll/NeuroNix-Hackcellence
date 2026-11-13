import type { BuildResult, NearbyOption } from "../api/endpoints";
import { useI18n } from "../i18n/I18nProvider";
import Icon from "./Icon";
import "./Diagnostics.css";

type NoPackage = Extract<BuildResult, { status: "NO_PACKAGE" }>;

export interface TryChange {
  start_date: string;
  nights: number;
}

export default function NoPackageNotice({ result, onTry }: { result: NoPackage; onTry: (change: TryChange) => void }) {
  const { t, ts } = useI18n();
  const nearby: NearbyOption[] = result.nearby ?? [];
  return (
    <div className="card notice diag" role="alert">
      <p className="notice__title">{t("np.title")}</p>
      <ul className="diag__reasons">
        {result.reasons.map((r) => (
          <li key={r.code}>
            <Icon name="warning" className="diag__reason-icon" />
            <span>{ts(r.message)}</span>
          </li>
        ))}
      </ul>
      {nearby.length > 0 && (
        <>
          <p className="diag__heading">{t("np.otherDates")}</p>
          <ul className="diag__options">
            {nearby.map((o) => (
              <li key={`${o.start_date}-${o.nights}`}>
                <div className="diag__text">
                  <span>{ts(o.message)}</span>
                  <span className={`diag__fit ${o.within_budget ? "diag__fit--ok" : "diag__fit--over"}`}>
                    <Icon name={o.within_budget ? "check" : "warning"} />
                    <span>{o.within_budget ? t("c.withinBudget") : t("pk.over")}</span>
                  </span>
                </div>
                <button type="button" className="btn btn--secondary" onClick={() => onTry({ start_date: o.start_date, nights: o.nights })}>
                  {o.kind === "other_nights" ? t("np.tryNights", { n: o.nights }) : t("np.tryDates")}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
