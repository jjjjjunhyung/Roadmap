import type { Kind } from "../lib/api";

const PATHS: Record<Kind, string> = {
  meal: "M7 3v8M5 3v5a2 2 0 0 0 4 0V3M7 11v10M17 21V3c-2 1.5-3 4-3 7h3",
  dinner: "M4 13h16M5 13a7 7 0 0 1 14 0M12 6V4M3 17h18",
  cafe: "M4 9h12v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5V9zM16 10h1.5a2.5 2.5 0 0 1 0 5H16M8 3c0 2 1.5 2 1.5 4M12 3c0 2 1.5 2 1.5 4",
  play: "M12 3l2.2 5.6L20 9.3l-4.4 3.9L17 19l-5-3-5 3 1.4-5.8L4 9.3l5.8-.7z",
  drink: "M7 3h10l-1 7a4 4 0 0 1-8 0L7 3zM12 14v6M8.5 20h7",
  walk: "M13 4.5a1.5 1.5 0 1 0 0-3M11 21l2-6-3-3 1-5 4 3h3M8 13l-2 8",
};

export function Glyph({ kind }: { kind: Kind }) {
  return (
    <svg
      className="glyph"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.3}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={PATHS[kind] ?? PATHS.play} />
    </svg>
  );
}
