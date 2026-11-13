import { inr } from "../lib/format";
import Icon from "./Icon";

/** Total against budget (M5): the total, the budget, and the amount left or over, with a bar. */
export default function BudgetBar({ total, budget }: { total: number; budget: number }) {
  const left = budget - total;
  const over = left < 0;
  const used = budget > 0 ? Math.min(100, Math.round((total / budget) * 100)) : 100;
  return (
    <div className="budget">
      <div className="budget__row">
        <span className="budget__total">{inr(total)}</span>
        <span className="budget__of">of {inr(budget)} budget</span>
      </div>
      <div
        role="progressbar"
        aria-label="Budget used"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={used}
        className={`budget__bar${over ? " budget__bar--over" : ""}`}
      >
        <span className="budget__fill" style={{ width: `${used}%` }} />
      </div>
      <p className={`budget__left ${over ? "budget__left--over" : "budget__left--ok"}`}>
        <Icon name={over ? "warning" : "check"} />
        <span>{over ? `${inr(-left)} over` : `${inr(left)} left`}</span>
      </p>
    </div>
  );
}
