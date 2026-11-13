import "./Icon.css";

/**
 * House rule: icons are inline SVG, never emoji. Every icon is drawn on a 24 x 24 grid with a 2px
 * round stroke and takes its colour from the surrounding text (`currentColor`).
 */
const PATHS = {
  flight: ["m22 2-7 20-4-9-9-4Z", "M22 2 11 13"],
  hotel: ["M2 4v16", "M2 8h18a2 2 0 0 1 2 2v10", "M2 17h20", "M6 8v9"],
  transfer: [
    "M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2",
    "M5 17a2 2 0 1 0 4 0 2 2 0 1 0-4 0",
    "M9 17h6",
    "M15 17a2 2 0 1 0 4 0 2 2 0 1 0-4 0",
  ],
  attraction: [
    "M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z",
    "M13 5v2",
    "M13 11v2",
    "M13 17v2",
  ],
  check: ["m5 12 5 5L20 7"],
  cross: ["M18 6 6 18", "m6 6 12 12"],
  warning: ["m21.7 18-8-14a2 2 0 0 0-3.5 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3", "M12 9v4", "M12 17h.01"],
  arrow: ["M5 12h14", "m12 5 7 7-7 7"],
} as const;

export type IconName = keyof typeof PATHS;
export const ICON_NAMES = Object.keys(PATHS) as IconName[];

interface Props {
  name: IconName;
  /** Accessible name. Leave out when the icon only decorates text that is already there. */
  label?: string;
  className?: string;
}

export default function Icon({ name, label, className }: Props) {
  return (
    <svg
      className={["icon", className].filter(Boolean).join(" ")}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : "true"}
      focusable="false"
    >
      {PATHS[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

const ITEM_ICON = { flight: "flight", hotel: "hotel", transfer: "transfer", attraction: "attraction" } as const;

/** The icon for a kind of trip item (decorative: the item's name is next to it). */
export function ItemIcon({ type }: { type: keyof typeof ITEM_ICON }) {
  return <Icon name={ITEM_ICON[type]} className="icon--item" />;
}
