import { useCallback, useEffect, useRef } from "react";

import { reducedMotion } from "../lib/feel";

/** setTimeout that the game forgets when it goes away (and hurries when motion is reduced). */
export function useLater() {
  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  return useCallback((f: () => void, ms: number) => {
    timers.current.push(window.setTimeout(f, reducedMotion() ? Math.min(ms, 40) : ms));
  }, []);
}

/** The latest onPicked, for animation loops that outlive a render. */
export function useLatest<T>(value: T) {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  }, [value]);
  return ref;
}

export const pickOne = <T>(xs: readonly T[]) => xs[Math.floor(Math.random() * xs.length)];

/** A theme colour read from CSS, for canvas drawing. */
export const cssVar = (el: Element, name: string) =>
  getComputedStyle(el).getPropertyValue(name).trim();

/** Heart, as in the seal and the hearts game. */
export const HEART =
  "M12 21s-7.5-4.6-9.6-9.2C.9 8.4 3 4.5 6.7 4.5c2.1 0 3.6 1.1 4.3 2.4h2c.7-1.3 2.2-2.4 4.3-2.4 3.7 0 5.8 3.9 4.3 7.3C19.5 16.4 12 21 12 21z";
