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
  calendar: ["M8 2v4", "M16 2v4", "M3 10h18", "M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z"],
  users: ["M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2", "M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z", "M22 21v-2a4 4 0 0 0-3-3.9", "M16 3.1a4 4 0 0 1 0 7.8"],
  wallet: ["M21 12V7H5a2 2 0 0 1 0-4h14v4", "M3 5v14a2 2 0 0 0 2 2h16v-5", "M18 12a2 2 0 0 0 0 4h4v-4Z"],
  clock: ["M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z", "M12 6v6l4 2"],
  star: ["m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8-6.2-3.2-6.2 3.2L7 14.2 2 9.3l6.9-1L12 2Z"],
  mic: ["M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z", "M19 10v2a7 7 0 0 1-14 0v-2", "M12 19v3"],
  speaker: ["M11 5 6 9H2v6h4l5 4V5Z", "M15.5 8.5a5 5 0 0 1 0 7", "M19 5a10 10 0 0 1 0 14"],
  copy: ["M8 8h12v12H8Z", "M16 8V4H4v12h4"],
  printer: ["M6 9V2h12v7", "M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2", "M6 14h12v8H6Z"],
  search: ["M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z", "m21 21-4.3-4.3"],
  file: ["M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z", "M14 2v6h6", "M16 13H8", "M16 17H8"],
  pin: ["M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z", "M12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"],
  info: ["M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z", "M12 16v-4", "M12 8h.01"],
  plus: ["M12 5v14", "M5 12h14"],
  trash: ["M3 6h18", "M8 6V4h8v2", "M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6", "M10 11v6", "M14 11v6"],
  chevron: ["m6 9 6 6 6-6"],
  shield: ["M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z", "m9 12 2 2 4-4"],
  moon: ["M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"],
  edit: ["M12 20h9", "M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"],
  home: ["m3 11 9-8 9 8", "M5 10v10h14V10", "M10 20v-6h4v6"],
  grip: ["M9 5h.01", "M15 5h.01", "M9 12h.01", "M15 12h.01", "M9 19h.01", "M15 19h.01"],
  route: ["M6 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z", "M18 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z", "M8 17h7.5a3.5 3.5 0 0 0 0-7h-7a3.5 3.5 0 0 1 0-7H16"],
  chat: ["M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z", "M8 9h8", "M8 13h5"],
  send: ["m22 2-11 11", "m22 2-7 20-4-9-9-4Z"],
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
