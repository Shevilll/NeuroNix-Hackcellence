import { useState } from "react";
import { checkTrip, type CheckReport } from "../api/endpoints";
import Icon from "./Icon";
import RuleChecklist from "./RuleChecklist";

/** S3: load any trip JSON and test it against every travel rule. */
export default function CheckerPanel() {
  const [report, setReport] = useState<CheckReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  async function load(file: File | undefined) {
    setReport(null);
    setError(null);
    setFileName(file?.name ?? null);
    if (!file) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      setError("That file is not valid JSON.");
      return;
    }
    try {
      setReport(await checkTrip(parsed));
    } catch {
      setError("Could not check the file. Is the backend running?");
    }
  }

  return (
    <section className="card checker" aria-label="Trip checker">
      <div className="checker__drop">
        <span className="checker__icon">
          <Icon name="file" />
        </span>
        <div>
          <p className="checker__title">Load an exported trip JSON</p>
          <p className="muted">We run the same validator the app uses on every package: dates, flights, transfers, hotels, attractions and prices.</p>
        </div>
        <input type="file" accept="application/json,.json" aria-label="Trip JSON file" onChange={(e) => void load(e.target.files?.[0])} />
      </div>
      {error && (
        <p role="alert" className="inline-error inline-error--box">
          <Icon name="warning" /> {error}
        </p>
      )}
      {report && (
        <div className="checker__result">
          <p role="status" className={report.valid ? "rules__verdict rules__verdict--ok" : "rules__verdict rules__verdict--bad"}>
            <Icon name={report.valid ? "check" : "warning"} />
            {report.valid ? `${fileName ?? "The file"}: all rules pass.` : `${report.violations.length} problem(s) found.`}
          </p>
          <RuleChecklist report={report} />
        </div>
      )}
    </section>
  );
}
