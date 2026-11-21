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
  play: "활동",
  dinner: "저녁",
  drink: "술 한잔",
  walk: "산책",
};

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
