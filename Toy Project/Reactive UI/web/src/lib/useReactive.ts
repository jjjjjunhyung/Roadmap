import { type RefObject, useEffect } from "react";

import { haptic, reducedMotion, sfx } from "./feel";

/**
 * Makes an element (with class "r") lean toward the pointer, move its glare,
 * pull slightly like a magnet, and squash while pressed.
 */
export function useReactive(ref: RefObject<HTMLElement | null>, { tilt = 12, magnet = 6 } = {}) {
  useEffect(() => {
    const el = ref.current;
    if (!el || reducedMotion()) return;
    const clamp = (v: number) => Math.min(1, Math.max(0, v));
    const move = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      const px = clamp((e.clientX - r.left) / r.width);
      const py = clamp((e.clientY - r.top) / r.height);
      el.classList.add("live");
      el.style.setProperty("--ry", `${(px - 0.5) * tilt}deg`);
      el.style.setProperty("--rx", `${(0.5 - py) * tilt}deg`);
      el.style.setProperty("--mx", `${(px - 0.5) * magnet}px`);
      el.style.setProperty("--my", `${(py - 0.5) * magnet}px`);
      el.style.setProperty("--gx", `${px * 100}%`);
      el.style.setProperty("--gy", `${py * 100}%`);
    };
    const leave = () => {
      el.classList.remove("live", "pressed");
      for (const v of ["--rx", "--ry", "--mx", "--my"]) el.style.removeProperty(v);
    };
    const down = (e: PointerEvent) => {
      move(e);
      el.classList.add("pressed");
      sfx.tick();
      haptic(6);
    };
    const up = () => el.classList.remove("pressed");
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerleave", leave);
    el.addEventListener("pointercancel", leave);
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointerup", up);
    return () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerleave", leave);
      el.removeEventListener("pointercancel", leave);
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointerup", up);
    };
  }, [ref, tilt, magnet]);
}
