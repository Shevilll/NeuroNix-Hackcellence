import type { BuildResult } from "../api/endpoints";
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
  const details = result.suggestion_details;
  return (
    <div className="card notice diag" role="alert">
      <p className="notice__title">Over budget</p>
      <p className="notice__text">
        The cheapest package costs {inr(result.cheapest_total)}, which is {inr(result.short_by)} more than your
        budget of {inr(result.budget)}.
      </p>
      {details ? (
        <ul className="diag__options">
          {details.map((d) => (
            <li key={d.kind + d.message}>
              <div className="diag__text">
                <span>{d.message}</span>
                {d.kind !== "raise_budget" && (
                  <span className="diag__fit diag__fit--ok">
                    <Icon name="check" />
                    <span>Within budget</span>
                  </span>
                )}
              </div>
              {d.kind === "raise_budget" ? (
                <button type="button" className="btn btn--primary" onClick={() => onRaise(result.cheapest_total)}>
                  Raise budget to {inr(result.cheapest_total)}
                </button>
              ) : (
                <button type="button" className="btn btn--secondary" onClick={() => onTry({ start_date: d.start_date, nights: d.nights })}>
                  {d.kind === "fewer_nights" ? `Use ${d.nights} nights` : "Use these dates"}
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        result.suggestions.map((t) => (
          <p key={t} className="notice__text">
            {t}
          </p>
        ))
      )}
    </div>
  );
}
