import type { CheckReport } from "../api/endpoints";
import { useI18n } from "../i18n/I18nProvider";
import Icon from "./Icon";

export default function RuleChecklist({ report }: { report: CheckReport }) {
  const { t, ts, group } = useI18n();
  return (
    <div className="checklist" aria-label={t("rules.aria")}>
      <ul>
        {report.checklist.map((g) => (
          <li key={g.group} className={g.ok ? "ok" : "bad"}>
            <Icon name={g.ok ? "check" : "cross"} /> {group(g.group)}
            <span className="sr-only">{" "}{g.ok ? t("rules.passes") : t("rules.fails")}</span>
          </li>
        ))}
      </ul>
      {report.violations.length > 0 && (
        <ul className="violations">
          {report.violations.map((v, n) => (
            <li key={n}><b>{group(v.group)}:</b> {ts(v.message)} <code>{v.code}</code></li>
          ))}
        </ul>
      )}
    </div>
  );
}
