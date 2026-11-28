import type { Kind } from "../lib/api";

const PATHS: Record<Kind, string> = {
  meal: "M7 3v8M5 3v5a2 2 0 0 0 4 0V3M7 11v10M17 21V3c-2 1.5-3 4-3 7h3",
  dinner: "M4 13h16M5 13a7 7 0 0 1 14 0M12 6V4M3 17h18",
  cafe: "M4 9h12v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5V9zM16 10h1.5a2.5 2.5 0 0 1 0 5H16M8 3c0 2 1.5 2 1.5 4M12 3c0 2 1.5 2 1.5 4",
  play: "M12 3l2.2 5.6L20 9.3l-4.4 3.9L17 19l-5-3-5 3 1.4-5.8L4 9.3l5.8-.7z",
  drink: "M7 3h10l-1 7a4 4 0 0 1-8 0L7 3zM12 14v6M8.5 20h7",
  walk: "M13 4.5a1.5 1.5 0 1 0 0-3M11 21l2-6-3-3 1-5 4 3h3M8 13l-2 8",
  shop: "M5 8h14l-1 13H6zM9 8V6a3 3 0 0 1 6 0v2",
  photo: "M4 8h3l2-3h6l2 3h3v11H4zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
  drive:
    "M3 15l2-6a2 2 0 0 1 2-1.5h10A2 2 0 0 1 19 9l2 6v3H3zM7 18v2M17 18v2M3 15h18M7 12.5h.01M17 12.5h.01",
  arcade:
    "M6 9h12a3 3 0 0 1 3 3v3a3 3 0 0 1-5.2 2L14 15h-4l-1.8 2A3 3 0 0 1 3 15v-3a3 3 0 0 1 3-3zM8 11v3M6.5 12.5h3M15.5 12h.01M17.5 13.5h.01",
  stay: "M3 18V7M3 13h18v5M21 18v-3a3 3 0 0 0-3-3h-7v1M7 11a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3",
  movie: "M4 7h16v13H4zM4 7l2.5-4M9.5 7 12 3M15 7l2.5-4M4 11h16",
  show: "M12 3l2.6 2.4L18 5l.6 3.4L21 11l-2.4 2.6L19 17l-3.4.6L13 20l-2.6-2.4L7 18l-.6-3.4L4 12l2.4-2.6L6 6l3.4-.6zM12 15a3 3 0 1 0 0-6",
  exhibit: "M4 4h16v16H4zM7 16l3.5-4 2.5 3 2-2 2 3M15 9h.01",
  home: "M4 11l8-7 8 7v9H4zM10 20v-5h4v5",
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
