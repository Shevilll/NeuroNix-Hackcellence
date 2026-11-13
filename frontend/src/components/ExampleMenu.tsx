import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { EXAMPLE_GROUPS, EXAMPLES, type Example } from "../domain/examples";
import { useI18n } from "../i18n/I18nProvider";
import Icon from "./Icon";
import "./ExampleMenu.css";

/**
 * "Load an example" menu: the main example, edge cases and error cases. Picking one fills the
 * form and builds it at once, so a judge never has to type a request. Follows the ARIA menu
 * button pattern: arrow keys move, Escape closes and returns focus to the button.
 */
export default function ExampleMenu({ onPick, disabled = false }: { onPick: (example: Example) => void; disabled?: boolean }) {
  const { t } = useI18n();
  const groupLabel = (g: string) => t(g === "Main example" ? "form.group.main" : g === "Edge cases" ? "form.group.edge" : "form.group.error");
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    if (!open) return;
    itemRefs.current[0]?.focus();
    function onPointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  function close() {
    setOpen(false);
    buttonRef.current?.focus();
  }

  function onMenuKeyDown(event: KeyboardEvent) {
    const items = itemRefs.current.filter(Boolean) as HTMLButtonElement[];
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    const move = (to: number) => {
      event.preventDefault();
      items[(to + items.length) % items.length]?.focus();
    };
    if (event.key === "ArrowDown") move(at + 1);
    else if (event.key === "ArrowUp") move(at - 1);
    else if (event.key === "Home") move(0);
    else if (event.key === "End") move(items.length - 1);
    else if (event.key === "Escape") {
      event.preventDefault();
      close();
    } else if (event.key === "Tab") setOpen(false);
  }

  function pick(example: Example) {
    setOpen(false);
    onPick(example);
  }

  let index = 0;
  return (
    <div className="examples" ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className="btn btn--secondary examples__button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? "examples-menu" : undefined}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        {t("form.examples")}
        <Icon name="chevron" className={`examples__chevron${open ? " examples__chevron--open" : ""}`} />
      </button>
      {open && (
        <div id="examples-menu" className="examples__menu" role="menu" aria-label={t("form.examplesAria")} onKeyDown={onMenuKeyDown}>
          <p className="examples__note">{t("form.examplesNote")}</p>
          {EXAMPLE_GROUPS.map((group) => (
            <div key={group} role="group" aria-label={groupLabel(group)} className="examples__group">
              <p className="examples__heading" aria-hidden="true">
                {groupLabel(group)}
              </p>
              {EXAMPLES.filter((e) => e.group === group).map((example) => {
                const i = index++;
                return (
                  <button
                    key={example.id}
                    ref={(el) => (itemRefs.current[i] = el)}
                    type="button"
                    role="menuitem"
                    tabIndex={-1}
                    className={`examples__item examples__item--${group === "Error cases" ? "error" : group === "Edge cases" ? "edge" : "main"}`}
                    onClick={() => pick(example)}
                  >
                    <span className="examples__title">{t(`ex.${example.id}.title`)}</span>
                    <span className="examples__shows">{t(`ex.${example.id}.shows`)}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
