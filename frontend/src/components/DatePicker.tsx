import { useEffect, useRef, useState } from "react";
import { formatLongDate } from "../domain/requestValidation";
import { useI18n } from "../i18n/I18nProvider";
import "./controls.css";
import "./DatePicker.css";

interface Props {
  id: string;
  /** id of the element whose text names this control (the field label). */
  labelledBy: string;
  /** ISO date (YYYY-MM-DD), or "" when nothing is chosen. */
  value: string;
  min: string;
  max: string;
  onChange: (iso: string) => void;
  invalid?: boolean;
  describedBy?: string;
}

const WEEKDAYS: Record<string, string[]> = {
  en: ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"],
  hi: ["र", "सो", "मं", "बु", "गु", "शु", "श"],
};
const HINDI_MONTHS = ["जनवरी", "फ़रवरी", "मार्च", "अप्रैल", "मई", "जून", "जुलाई", "अगस्त", "सितंबर", "अक्टूबर", "नवंबर", "दिसंबर"];
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const pad = (n: number) => String(n).padStart(2, "0");
const toIso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

/** Year and 1-based month of an ISO date. */
function yearMonth(iso: string): { year: number; month: number } {
  const [year, month] = iso.split("-").map(Number);
  return { year, month };
}

/** Shifts a year/month pair by whole months. */
function shiftMonth(year: number, month: number, delta: number) {
  const index = year * 12 + (month - 1) + delta;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

/** Custom calendar that replaces the native date input. Days outside min..max are disabled. */
export default function DatePicker({ id, labelledBy, value, min, max, onChange, invalid, describedBy }: Props) {
  const { t, lang } = useI18n();
  const monthName = (m: number) => (lang === "hi" ? HINDI_MONTHS : MONTH_NAMES)[m - 1];
  const [open, setOpen] = useState(false);
  const [view, setView] = useState(() => yearMonth(value || min));
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const valueId = `${id}-value`;

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Move focus into the calendar when it opens, so the keyboard can pick a day straight away.
  useEffect(() => {
    if (!open) return;
    const target =
      dialogRef.current?.querySelector<HTMLButtonElement>("[aria-pressed='true']") ??
      dialogRef.current?.querySelector<HTMLButtonElement>("button[data-day]:not(:disabled)");
    target?.focus();
  }, [open]);

  function openCalendar() {
    setView(yearMonth(value || min));
    setOpen(true);
  }

  function pickDay(iso: string) {
    onChange(iso);
    setOpen(false);
    triggerRef.current?.focus();
  }

  const minYM = yearMonth(min);
  const maxYM = yearMonth(max);
  const viewIndex = view.year * 12 + view.month;
  const canGoBack = viewIndex > minYM.year * 12 + minYM.month;
  const canGoForward = viewIndex < maxYM.year * 12 + maxYM.month;

  const daysInMonth = new Date(Date.UTC(view.year, view.month, 0)).getUTCDate();
  const leadingBlanks = new Date(Date.UTC(view.year, view.month - 1, 1)).getUTCDay();

  const days = Array.from({ length: daysInMonth }, (_, i) => {
    const iso = toIso(view.year, view.month, i + 1);
    return { day: i + 1, iso, disabled: iso < min || iso > max };
  });

  return (
    <div className="control" ref={rootRef}>
      <button
        id={id}
        ref={triggerRef}
        type="button"
        aria-labelledby={labelledBy}
        aria-describedby={[valueId, describedBy].filter(Boolean).join(" ")}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-invalid={invalid ? true : undefined}
        className={`control__trigger${invalid ? " control__trigger--invalid" : ""}${open ? " control__trigger--open" : ""}`}
        onClick={() => (open ? setOpen(false) : openCalendar())}
      >
        <span
          id={valueId}
          className={value ? "control__value" : "control__value control__value--placeholder"}
        >
          {value ? formatLongDate(value, lang) : t("dp.pick")}
        </span>
        <svg className="control__icon" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <rect x="3" y="5" width="18" height="16" rx="2" fill="none" stroke="currentColor" strokeWidth="1.8" />
          <path d="M3 10h18M8 3v4M16 3v4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      </button>

      {open && (
        <div ref={dialogRef} role="dialog" aria-label={t("dp.choose")} className="control__panel date-picker">
          <div className="date-picker__head">
            <button
              type="button"
              className="date-picker__nav"
              aria-label={t("dp.prev")}
              disabled={!canGoBack}
              onClick={() => setView((v) => shiftMonth(v.year, v.month, -1))}
            >
              <span aria-hidden="true">‹</span>
            </button>
            <div className="date-picker__title" aria-live="polite">
              {monthName(view.month)} {view.year}
            </div>
            <button
              type="button"
              className="date-picker__nav"
              aria-label={t("dp.next")}
              disabled={!canGoForward}
              onClick={() => setView((v) => shiftMonth(v.year, v.month, 1))}
            >
              <span aria-hidden="true">›</span>
            </button>
          </div>

          <div className="date-picker__grid" role="group" aria-label={`${monthName(view.month)} ${view.year}`}>
            {(WEEKDAYS[lang] ?? WEEKDAYS.en).map((w) => (
              <span key={w} className="date-picker__weekday" aria-hidden="true">
                {w}
              </span>
            ))}
            {Array.from({ length: leadingBlanks }, (_, i) => (
              <span key={`blank-${i}`} aria-hidden="true" />
            ))}
            {days.map((d) => {
              const chosen = d.iso === value;
              return (
                <button
                  key={d.iso}
                  type="button"
                  data-day
                  className={`date-picker__day${chosen ? " date-picker__day--chosen" : ""}`}
                  aria-pressed={chosen}
                  disabled={d.disabled}
                  onClick={() => pickDay(d.iso)}
                >
                  {d.day}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
