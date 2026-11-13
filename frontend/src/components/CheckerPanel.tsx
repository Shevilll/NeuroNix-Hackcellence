import { useState } from "react";
import { checkTrip, type CheckReport } from "../api/endpoints";
import RuleChecklist from "./RuleChecklist";

export default function CheckerPanel() {
  const [report, setReport] = useState<CheckReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load(file: File | undefined) {
    setReport(null);
    setError(null);
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
    <section className="card" aria-label="Trip checker">
      <h3>Check a trip file</h3>
      <p className="notice__text">Load an exported trip JSON to test it against every travel rule.</p>
      <input type="file" accept="application/json,.json" aria-label="Trip JSON file"
        onChange={(e) => void load(e.target.files?.[0])} />
      {error && <p role="alert">{error}</p>}
      {report && (
        <>
          <p role="status"><strong>{report.valid ? "All rules pass." : `${report.violations.length} problem(s) found.`}</strong></p>
          <RuleChecklist report={report} />
        </>
      )}
    </section>
  );
}
