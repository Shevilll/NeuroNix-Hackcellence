import { inr } from "../lib/format";
import { useI18n } from "../i18n/I18nProvider";
import Icon from "./Icon";

/** Total against budget (M5): the total, the budget, and the amount left or over, with a bar. */
export default function BudgetBar({ total, budget }: { total: number; budget: number }) {
  const { t } = useI18n();
  const left = budget - total;
  const over = left < 0;
  const used = budget > 0 ? Math.min(100, Math.round((total / budget) * 100)) : 100;
  return (
    <div className="budget">
      <div className="budget__row">
        <span className="budget__total">{inr(total)}</span>
        <span className="budget__of">{t("budget.of", { amount: inr(budget) })}</span>
      </div>
      <div
        role="progressbar"
        aria-label={t("budget.used")}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={used}
        className={`budget__bar${over ? " budget__bar--over" : ""}`}
      >
        <span className="budget__fill" style={{ width: `${used}%` }} />
      </div>
      <p className={`budget__left ${over ? "budget__left--over" : "budget__left--ok"}`}>
        <Icon name={over ? "warning" : "check"} />
        <span>{over ? t("budget.over", { amount: inr(-left) }) : t("budget.left", { amount: inr(left) })}</span>
      </p>
    </div>
  );
}
