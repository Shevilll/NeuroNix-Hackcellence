import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import "./controls.css";

export interface SelectOption {
  value: string;
  label: string;
}

interface Props {
  id: string;
  /** id of the element whose text names this control (the field label). */
  labelledBy: string;
  value: string;
  options: SelectOption[];
  placeholder: string;
  onChange: (value: string) => void;
  invalid?: boolean;
  describedBy?: string;
}

/**
 * Custom dropdown that replaces the native <select>, so the list matches the app's look.
 * Follows the ARIA combobox pattern: the trigger keeps focus and points at the highlighted
 * option with aria-activedescendant.
 */
export default function Select({ id, labelledBy, value, options, placeholder, onChange, invalid, describedBy }: Props) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLDivElement>(null);

  const selectedIndex = options.findIndex((o) => o.value === value);
  const selected = selectedIndex >= 0 ? options[selectedIndex] : undefined;
  const listId = `${id}-listbox`;

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  function openList() {
    setActive(selectedIndex >= 0 ? selectedIndex : 0);
    setOpen(true);
  }

  function choose(index: number) {
    const option = options[index];
    if (option) onChange(option.value);
    setOpen(false);
    triggerRef.current?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
        event.preventDefault();
        openList();
      }
      return;
    }
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        setActive((a) => Math.min(a + 1, options.length - 1));
        break;
      case "ArrowUp":
        event.preventDefault();
        setActive((a) => Math.max(a - 1, 0));
        break;
      case "Home":
        event.preventDefault();
        setActive(0);
        break;
      case "End":
        event.preventDefault();
        setActive(options.length - 1);
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        choose(active);
        break;
      case "Escape":
        event.preventDefault();
        setOpen(false);
        break;
      case "Tab":
        setOpen(false);
        break;
    }
  }

  return (
    <div className="control" ref={rootRef}>
      <div
        id={id}
        ref={triggerRef}
        role="combobox"
        tabIndex={0}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-labelledby={labelledBy}
        aria-invalid={invalid ? true : undefined}
        aria-describedby={describedBy}
        aria-activedescendant={open ? `${id}-option-${active}` : undefined}
        className={`control__trigger${invalid ? " control__trigger--invalid" : ""}${open ? " control__trigger--open" : ""}`}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={onKeyDown}
      >
        <span className={selected ? "control__value" : "control__value control__value--placeholder"}>
          {selected ? selected.label : placeholder}
        </span>
        <svg className="control__icon control__icon--chevron" width="12" height="8" viewBox="0 0 12 8" aria-hidden="true" focusable="false">
          <path d="M1 1.5 6 6.5 11 1.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>

      {open && (
        <ul id={listId} role="listbox" aria-labelledby={labelledBy} className="control__panel select__list">
          {options.map((option, i) => (
            <li
              key={option.value}
              id={`${id}-option-${i}`}
              role="option"
              aria-selected={i === active}
              className={`select__option${i === active ? " select__option--active" : ""}${
                option.value === value ? " select__option--chosen" : ""
              }`}
              onMouseEnter={() => setActive(i)}
              onClick={() => choose(i)}
            >
              {option.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
