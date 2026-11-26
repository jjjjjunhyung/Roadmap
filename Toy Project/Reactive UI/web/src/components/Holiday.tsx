import { type CSSProperties, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { haptic, reducedMotion, sfx } from "../lib/feel";

/** The holiday look's base color, for the browser's own bars. */
const NIGHT = "#0d1226";

/**
 * The winter night behind a shared page whose planner chose the holiday theme: the whole page
 * takes the night palette (data-look on the root), a starry sky sits behind everything and snow
 * falls between the sky and the content, so it never covers text or buttons. Rubbing the screen
 * blows the snow about.
 */
export function HolidaySky() {
  const canvas = useRef<HTMLCanvasElement>(null);

  // the night palette for the whole page, and the browser bars to match, while this is shown
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.look = "holiday";
    const metas = [...document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')];
    const before = metas.map((m) => m.content);
    for (const m of metas) m.content = NIGHT;
    return () => {
      delete root.dataset.look;
      metas.forEach((m, i) => (m.content = before[i]));
    };
  }, []);

  useEffect(() => {
    const cv = canvas.current;
    const ctx = cv?.getContext("2d");
    if (!cv || !ctx) return;
    let W = 0;
    let H = 0;
    let raf = 0;
    let last = 0;
    type Flake = {
      x: number;
      y: number;
      r: number;
      vy: number;
      amp: number;
      ph: number;
      fr: number;
      vx: number;
      vy2: number;
      a: number;
    };
    let flakes: Flake[] = [];
    const spawn = (anywhere: boolean): Flake => {
      const depth = Math.random();
      return {
        x: Math.random() * W,
        y: anywhere ? Math.random() * H : -8,
        r: 0.9 + depth * 2.6,
        vy: 14 + depth * 40,
        amp: 6 + Math.random() * 16,
        ph: Math.random() * Math.PI * 2,
        fr: 0.4 + Math.random() * 0.8,
        vx: 0,
        vy2: 0,
        a: 0.45 + depth * 0.5,
      };
    };
    const size = () => {
      const dpr = Math.min(2, devicePixelRatio || 1);
      W = innerWidth;
      H = innerHeight;
      cv.style.width = `${W}px`;
      cv.style.height = `${H}px`;
      cv.width = Math.round(W * dpr);
      cv.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const n = Math.min(140, Math.round((W * H) / 8000));
      while (flakes.length < n) flakes.push(spawn(true));
      flakes.length = n;
    };
    const draw = () => {
      ctx.clearRect(0, 0, W, H);
      for (const f of flakes) {
        ctx.fillStyle = `rgba(255,255,255,${f.a})`;
        ctx.beginPath();
        ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
        ctx.fill();
      }
    };
    const frame = (t: number) => {
      const dt = Math.min(0.05, last ? (t - last) / 1000 : 0.016);
      last = t;
      const s = t / 1000;
      const k = Math.exp(-2.4 * dt);
      for (const f of flakes) {
        f.vx *= k;
        f.vy2 *= k;
        f.x += (Math.cos(f.ph + s * f.fr) * f.amp + f.vx) * dt;
        f.y += (f.vy + f.vy2) * dt;
        if (f.y > H + 10 || f.y < -40) Object.assign(f, spawn(false));
        if (f.x < -10) f.x += W + 20;
        else if (f.x > W + 10) f.x -= W + 20;
      }
      draw();
      raf = requestAnimationFrame(frame);
    };
    const run = () => {
      cancelAnimationFrame(raf);
      last = 0;
      if (reducedMotion()) draw();
      else if (document.visibilityState === "visible") raf = requestAnimationFrame(frame);
    };
    flakes = [];
    size();
    run();

    // a finger or the mouse pushes the flakes it passes
    let lp: { x: number; y: number; t: number } | null = null;
    const push = (x: number, y: number) => {
      const now = performance.now();
      if (lp) {
        const dt = Math.max(0.016, (now - lp.t) / 1000);
        const vx = Math.max(-1400, Math.min(1400, (x - lp.x) / dt));
        const vy = Math.max(-1400, Math.min(1400, (y - lp.y) / dt));
        for (const f of flakes) {
          const d = Math.hypot(f.x - x, f.y - y);
          if (d < 90) {
            const fall = 1 - d / 90;
            f.vx += vx * 0.3 * fall;
            f.vy2 += vy * 0.3 * fall;
          }
        }
      }
      lp = { x, y, t: now };
    };
    const onPointer = (e: PointerEvent) => push(e.clientX, e.clientY);
    const onTouch = (e: TouchEvent) => {
      const t = e.touches[0];
      if (t) push(t.clientX, t.clientY);
    };
    const reset = () => (lp = null);
    const onResize = () => {
      size();
      if (reducedMotion()) draw();
    };
    window.addEventListener("pointermove", onPointer, { passive: true });
    window.addEventListener("touchmove", onTouch, { passive: true });
    window.addEventListener("touchend", reset);
    window.addEventListener("pointerup", reset);
    window.addEventListener("resize", onResize);
    document.addEventListener("visibilitychange", run);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onPointer);
      window.removeEventListener("touchmove", onTouch);
      window.removeEventListener("touchend", reset);
      window.removeEventListener("pointerup", reset);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", run);
    };
  }, []);

  return createPortal(
    <>
      <div className="holiday-sky" aria-hidden="true" />
      <canvas className="holiday-snow" ref={canvas} aria-hidden="true" />
    </>,
    document.body,
  );
}

const BULBS = ["#ffcf6e", "#ff5c70", "#5ed39b", "#79b8ff", "#ffe9bd"];

interface Bulb {
  x: number;
  y: number;
  color: string;
  delay: string;
  tilt: string;
}

/** Two swags of wire across the top of the page, six bulbs each. */
function hang(width: number): { wire: string; bulbs: Bulb[] } {
  const y0 = 4;
  const sag = 30;
  const pts: [number, number][] = [
    [-14, y0],
    [width / 2, y0],
    [width + 14, y0],
  ];
  let wire = `M ${pts[0][0]} ${y0}`;
  const bulbs: Bulb[] = [];
  for (let s = 0; s < 2; s++) {
    const [ax, ay] = pts[s];
    const [bx, by] = pts[s + 1];
    const cx = (ax + bx) / 2;
    const cy = y0 + 2 * sag;
    wire += ` Q ${cx} ${cy} ${bx} ${by}`;
    for (let k = 1; k <= 6; k++) {
      const t = k / 7;
      const u = 1 - t;
      bulbs.push({
        x: u * u * ax + 2 * u * t * cx + t * t * bx,
        y: u * u * ay + 2 * u * t * cy + t * t * by - 1,
        color: BULBS[bulbs.length % BULBS.length],
        delay: `${(-Math.random() * 2.8).toFixed(2)}s`,
        tilt: `${(Math.random() * 20 - 10).toFixed(1)}deg`,
      });
    }
  }
  return { wire, bulbs };
}

/** String lights along the top of the page; a tap turns a bulb off or on. */
export function StringLights() {
  const box = useRef<HTMLDivElement>(null);
  const [shape, setShape] = useState<{ width: number; wire: string; bulbs: Bulb[] } | null>(null);
  const [off, setOff] = useState<Set<number>>(() => new Set());

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const width = el.clientWidth;
      setShape((s) => (s && s.width === width ? s : { width, ...hang(width) }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const flip = (i: number) => {
    sfx.tick();
    haptic(6);
    setOff((o) => {
      const n = new Set(o);
      if (!n.delete(i)) n.add(i);
      return n;
    });
  };

  return (
    <div className="lights" ref={box}>
      {shape && (
        <>
          <svg width={shape.width} height={80} aria-hidden="true">
            <path d={shape.wire} />
          </svg>
          {shape.bulbs.map((b, i) => (
            <button
              key={i}
              type="button"
              className={`bulb${off.has(i) ? " off" : ""}`}
              aria-label={off.has(i) ? "전구 켜기" : "전구 끄기"}
              style={
                {
                  left: b.x,
                  top: b.y,
                  transform: `rotate(${b.tilt})`,
                  "--c": b.color,
                  "--d": b.delay,
                } as CSSProperties
              }
              onClick={() => flip(i)}
            >
              <i className="cap" />
              <i className="glass" />
            </button>
          ))}
        </>
      )}
    </div>
  );
}
