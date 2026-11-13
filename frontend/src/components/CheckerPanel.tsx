import { useState } from "react";
import { checkTrip, type CheckReport } from "../api/endpoints";
import { useI18n } from "../i18n/I18nProvider";
import Icon from "./Icon";
import RuleChecklist from "./RuleChecklist";
import Spinner from "./Spinner";

/** S3: load any trip JSON and test it against every travel rule. */
export default function CheckerPanel() {
  const { t, count } = useI18n();
  const [report, setReport] = useState<CheckReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  async function load(file: File | undefined) {
    setReport(null);
    setError(null);
    setFileName(file?.name ?? null);
    if (!file) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      setError(t("chk.badJson"));
      return;
    }
    setChecking(true);
    try {
      setReport(await checkTrip(parsed));
    } catch {
      setError(t("chk.fail"));
    } finally {
      setChecking(false);
    }
  }

  return (
    <section className="card checker" aria-label={t("chk.aria")}>
      <div className="checker__drop">
        <span className="checker__icon">
          <Icon name="file" />
        </span>
        <div>
          <p className="checker__title">{t("chk.load")}</p>
          <p className="muted">{t("chk.explain")}</p>
        </div>
        <input type="file" accept="application/json,.json" aria-label={t("chk.fileAria")} disabled={checking} onChange={(e) => void load(e.target.files?.[0])} />
      </div>
      {checking && <Spinner label={t("chk.checking")} showLabel />}
      {error && (
        <p role="alert" className="inline-error inline-error--box">
          <Icon name="warning" /> {error}
        </p>
      )}
      {report && (
        <div className="checker__result">
          <p role="status" className={report.valid ? "rules__verdict rules__verdict--ok" : "rules__verdict rules__verdict--bad"}>
            <Icon name={report.valid ? "check" : "warning"} />
            {report.valid ? t("chk.allPass", { file: fileName ?? t("chk.theFile") }) : t("pkg.problemsFound", { problems: count("problem", report.violations.length) })}
          </p>
          <RuleChecklist report={report} />
        </div>
      )}
    </section>
  );
}
