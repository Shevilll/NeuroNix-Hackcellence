import type { BuildResult } from "../api/endpoints";
import { useI18n } from "../i18n/I18nProvider";
import Icon from "./Icon";
import type { TryChange } from "./NoPackageNotice";
import "./Diagnostics.css";

type OverBudget = Extract<BuildResult, { status: "OVER_BUDGET" }>;

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

interface Props {
  result: OverBudget;
  onTry: (change: TryChange) => void;
  onRaise: (budget: number) => void;
}

export default function OverBudgetNotice({ result, onTry, onRaise }: Props) {
  const { t, ts } = useI18n();
  const details = result.suggestion_details;
  return (
    <div className="card notice diag" role="alert">
      <p className="notice__title">{t("ob.title")}</p>
      <p className="notice__text">
        {t("ob.text", { cheapest: inr(result.cheapest_total), short: inr(result.short_by), budget: inr(result.budget) })}
      </p>
      {details ? (
        <ul className="diag__options">
          {details.map((d) => (
            <li key={d.kind + d.message}>
              <div className="diag__text">
                <span>{ts(d.message)}</span>
                {d.kind !== "raise_budget" && (
                  <span className="diag__fit diag__fit--ok">
                    <Icon name="check" />
                    <span>{t("c.withinBudget")}</span>
                  </span>
                )}
              </div>
              {d.kind === "raise_budget" ? (
                <button type="button" className="btn btn--primary" onClick={() => onRaise(result.cheapest_total)}>
                  {t("ob.raise", { amount: inr(result.cheapest_total) })}
                </button>
              ) : (
                <button type="button" className="btn btn--secondary" onClick={() => onTry({ start_date: d.start_date, nights: d.nights })}>
                  {d.kind === "fewer_nights" ? t("ob.useNights", { n: d.nights }) : t("ob.useDates")}
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        result.suggestions.map((s) => (
          <p key={s} className="notice__text">
            {ts(s)}
          </p>
        ))
      )}
    </div>
  );
}
