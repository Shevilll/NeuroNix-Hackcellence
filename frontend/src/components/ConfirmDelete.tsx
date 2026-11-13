import { useState } from "react";
import { useI18n } from "../i18n/I18nProvider";
import Icon from "./Icon";
import Spinner from "./Spinner";

interface Props {
  /** Accessible name of the first button, e.g. "Delete booking 4435693622". */
  label: string;
  /** Visible text of the first button. */
  text: string;
  /** The question shown before anything is deleted. */
  question: string;
  /** Text of the button that really deletes. */
  confirmText: string;
  busy?: boolean;
  onConfirm: () => void;
}

/** A delete button that asks once before it deletes: nothing is sent until the traveller says yes. */
export default function ConfirmDelete({ label, text, question, confirmText, busy = false, onConfirm }: Props) {
  const { t } = useI18n();
  const [asking, setAsking] = useState(false);

  if (!asking) {
    return (
      <button type="button" className="btn btn--danger btn--sm" aria-label={label} onClick={() => setAsking(true)}>
        <Icon name="trash" /> {text}
      </button>
    );
  }
  return (
    <div className="confirm-delete" role="group" aria-label={label}>
      <p className="confirm-delete__question">
        <Icon name="warning" /> {question}
      </p>
      <div className="confirm-delete__actions">
        <button
          type="button"
          className="btn btn--danger-solid btn--sm"
          disabled={busy}
          onClick={() => {
            onConfirm();
          }}
        >
          {busy && <Spinner decorative />}
          {busy ? t("c.deleting") : confirmText}
        </button>
        <button type="button" className="btn btn--secondary btn--sm" disabled={busy} onClick={() => setAsking(false)}>
          {t("c.keep")}
        </button>
      </div>
    </div>
  );
}
