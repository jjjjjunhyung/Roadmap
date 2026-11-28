import type { CSSProperties } from "react";

import type { Kind } from "./api";

/** Aura artwork per candidate slot: [base, glow, light]. Same in both themes. */
export const AURA = [
  ["#8e2238", "#e29aa8", "#f4d3c6"], // garnet · blush · peach
  ["#22365f", "#8aa2d6", "#d2daf0"], // navy · periwinkle · mist
  ["#4b6656", "#a6c0aa", "#e4ebdb"], // sage
  ["#94621f", "#e2b46c", "#f5e1bd"], // ochre · honey
  ["#58304f", "#c08ab2", "#ecd5e4"], // plum · rose
  ["#2e3943", "#8fa0ab", "#dbe2e6"], // slate · ice
  ["#6b3b2a", "#d39a82", "#f1d9cc"], // umber · clay
  ["#284f55", "#86b6b8", "#d5e8e6"], // teal · sea glass
] as const;

export const aura = (index: number) => AURA[((index % AURA.length) + AURA.length) % AURA.length];
export const auraBase = (index: number) => aura(index)[0];
export const auraVars = (index: number) => {
  const [a1, a2, a3] = aura(index);
  return { "--a1": a1, "--a2": a2, "--a3": a3 } as CSSProperties;
};
export const two = (n: number) => String(n + 1).padStart(2, "0");

export const KIND_LABEL: Record<Kind, string> = {
  meal: "식사",
  cafe: "카페",
  dinner: "저녁",
  drink: "술 한잔",
  walk: "산책",
  play: "활동",
  shop: "쇼핑",
  photo: "사진",
  drive: "드라이브",
  arcade: "오락",
  stay: "호캉스",
  movie: "영화",
  show: "공연",
  exhibit: "전시",
  home: "집 데이트",
};

/**
 * What a step's candidates are: places on the map (a map link fills photo and location), works
 * (a movie, show or exhibition: one theater for the step, each candidate a title with a time) or
 * free (a date at home: a name, a note and a picture). Mirrors `form` in the server's validate.rs.
 */
export type Form = "place" | "work" | "free";
export function formOf(kind: Kind): Form {
  return kind === "movie" || kind === "show" || kind === "exhibit"
    ? "work"
    : kind === "home"
      ? "free"
      : "place";
}

/** Icon groups for the planner's menu. */
export const KIND_GROUPS: { name: string; kinds: Kind[] }[] = [
  { name: "장소", kinds: ["meal", "cafe", "dinner", "drink", "walk", "play", "shop", "photo"] },
  { name: "장소 · 더", kinds: ["drive", "arcade", "stay"] },
  { name: "작품 (극장 하나)", kinds: ["movie", "show", "exhibit"] },
  { name: "자유", kinds: ["home"] },
];

/** "2시간 17분", "45분" */
export function runtimeText(min: number) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h && m ? `${h}시간 ${m}분` : h ? `${h}시간` : `${m}분`;
}

/** A work's time on a card: "19:20 · 2시간 17분" (with its theater when asked). */
export function workLine(
  p: { starts_at: string; runtime_min: number | null; venue: string | null },
  withVenue = false,
) {
  return [
    withVenue ? p.venue : null,
    p.starts_at || null,
    p.runtime_min ? runtimeText(p.runtime_min) : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** "2026-12-24" → { md: "12.24", dow: "Thu" } */
export function formatDate(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(y, (m ?? 1) - 1, d ?? 1);
  return {
    md: `${String(m).padStart(2, "0")}.${String(d).padStart(2, "0")}`,
    dow: date.toLocaleDateString("en-US", { weekday: "short" }),
    full: date.toLocaleDateString("ko-KR", { month: "long", day: "numeric", weekday: "long" }),
  };
}

/** "중식당 · 논현동" for a place with a kind and a neighbourhood (either may be ""). */
export const placeLine = (p: { category: string; area: string }) =>
  [p.category, p.area].filter(Boolean).join(" · ");
