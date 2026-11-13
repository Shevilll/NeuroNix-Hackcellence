import "./Spinner.css";

interface Props {
  /** Announced to screen readers (and shown when `showLabel`). */
  label?: string;
  showLabel?: boolean;
  /** Use inside a control that already has its own text. */
  decorative?: boolean;
}

function Arc() {
  return (
    <svg className="spinner" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle className="spinner__track" cx="12" cy="12" r="9" fill="none" strokeWidth="3" />
      <circle className="spinner__arc" cx="12" cy="12" r="9" fill="none" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export default function Spinner({ label = "Loading", showLabel = false, decorative = false }: Props) {
  if (decorative) return <Arc />;
  return (
    <span role="status" className="spinner-wrap">
      <Arc />
      <span className={showLabel ? "spinner-label" : "sr-only"}>{label}</span>
    </span>
  );
}
