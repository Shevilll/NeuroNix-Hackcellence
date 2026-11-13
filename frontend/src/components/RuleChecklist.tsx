import type { CheckReport } from "../api/endpoints";
import Icon from "./Icon";

export default function RuleChecklist({ report }: { report: CheckReport }) {
  return (
    <div className="checklist" aria-label="Rule checklist">
      <ul>
        {report.checklist.map((g) => (
          <li key={g.group} className={g.ok ? "ok" : "bad"}>
            <Icon name={g.ok ? "check" : "cross"} /> {g.group}
            <span className="sr-only">{g.ok ? " passes" : " fails"}</span>
          </li>
        ))}
      </ul>
      {report.violations.length > 0 && (
        <ul className="violations">
          {report.violations.map((v, n) => (
            <li key={n}><b>{v.group}:</b> {v.message} <code>{v.code}</code></li>
          ))}
        </ul>
      )}
    </div>
  );
}
