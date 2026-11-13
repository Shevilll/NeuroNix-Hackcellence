/** Route mark: two stops joined by a path. Same artwork as public/favicon.svg. */
export default function Logo({ size = 36 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <rect width="64" height="64" rx="14" fill="#ffffff" />
      <path d="M17 46C17 22 47 44 47 19" fill="none" stroke="#003b95" strokeWidth="5" strokeLinecap="round" />
      <circle cx="17" cy="46" r="5.5" fill="#003b95" />
      <circle cx="47" cy="19" r="6.5" fill="#003b95" />
    </svg>
  );
}
