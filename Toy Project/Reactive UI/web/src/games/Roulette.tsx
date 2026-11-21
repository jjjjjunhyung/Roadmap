import { useEffect, useRef, useState } from "react";

import { haptic, reducedMotion, sfx } from "../lib/feel";
import { aura } from "../lib/look";
import type { GameProps } from "./types";

const TAU = Math.PI * 2;
const mod = (a: number) => ((a % TAU) + TAU) % TAU;

/** Draws `im` filling a square of side `s` centred on (x, y), cropping like object-fit: cover. */
function drawCover(
  ctx: CanvasRenderingContext2D,
  im: HTMLImageElement,
  x: number,
  y: number,
  s: number,
) {
  const k = Math.min(im.naturalWidth, im.naturalHeight);
  ctx.drawImage(
    im,
    (im.naturalWidth - k) / 2,
    (im.naturalHeight - k) / 2,
    k,
    k,
    x - s / 2,
    y - s / 2,
    s,
    s,
  );
}

/** Grab the wheel and throw it. Momentum + friction; the flapper snaps on every divider. */
export function Roulette({ candidates, indexOf, onPicked }: GameProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const flapRef = useRef<SVGSVGElement>(null);
  const hubRef = useRef<HTMLDivElement>(null);
  const spinRef = useRef<() => void>(() => {});
  const pickedRef = useRef(onPicked);
  const [hub, setHub] = useState("grab\n& spin");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    pickedRef.current = onPicked;
  }, [onPicked]);

  useEffect(() => {
    const cv = canvasRef.current;
    const ctx = cv?.getContext("2d");
    const flap = flapRef.current;
    if (!cv || !ctx || !flap) return;
    const N = candidates.length;
    const seg = TAU / N;
    const C = 320;
    const R = 320;
    const serif = getComputedStyle(document.documentElement).getPropertyValue("--serif").trim();
    const reduce = reducedMotion();
    let angle = -Math.PI / 2 - seg / 2;
    let vel = 0;
    let raf = 0;
    let dragging = false;
    let lastA = 0;
    let lastT = 0;
    let phase: "idle" | "coast" | "done" = "idle";
    let lastSeg = -1;
    let resultTimer = 0;
    // a photo per segment: centred along its bisector, big enough to cover the wedge
    const photoSize = Math.min(
      2 * R,
      Math.max(0.9 * R, 2.2 * R * Math.sin(Math.min(Math.PI / 2, seg / 2))),
    );
    const photoAt = N <= 2 ? 0.5 * R : 0.6 * R;
    const photos = candidates.map((c) => {
      if (!c.image_url) return null;
      const im = new Image();
      im.referrerPolicy = "no-referrer";
      im.decoding = "async";
      im.onload = () => draw();
      im.src = c.image_url;
      return im;
    });
    const segAtPointer = () => Math.floor(mod(-Math.PI / 2 - angle) / seg);

    const kick = () => {
      if (reduce) return;
      const frames = [{ transform: "rotate(-22deg)" }, { transform: "rotate(0)" }];
      try {
        flap.animate(frames, {
          duration: 280,
          easing: getComputedStyle(document.documentElement).getPropertyValue("--spring").trim(),
        });
      } catch {
        flap.animate(frames, { duration: 280, easing: "ease-out" });
      }
    };

    const draw = () => {
      ctx.clearRect(0, 0, 640, 640);
      candidates.forEach((c, i) => {
        const a0 = angle + i * seg;
        const [a1, a2] = aura(indexOf(c));
        const g = ctx.createRadialGradient(C, C, R * 0.2, C, C, R);
        g.addColorStop(0, a1);
        g.addColorStop(1, a2);
        ctx.beginPath();
        ctx.moveTo(C, C);
        ctx.arc(C, C, R, a0, a0 + seg);
        ctx.closePath();
        ctx.fillStyle = g;
        ctx.fill();
        const im = photos[i];
        if (im?.complete && im.naturalWidth) {
          ctx.save();
          ctx.clip();
          ctx.translate(C, C);
          ctx.rotate(a0 + seg / 2 + Math.PI / 2); // photo's top points to the rim
          drawCover(ctx, im, 0, -photoAt, photoSize);
          ctx.restore();
          // keep the names readable over the photo
          ctx.fillStyle = "rgba(10,12,16,.32)";
          ctx.fill();
        }
        ctx.save();
        ctx.translate(C, C);
        ctx.rotate(a0 + seg / 2);
        ctx.shadowColor = "rgba(0,0,0,.45)";
        ctx.shadowBlur = im?.complete && im.naturalWidth ? 8 : 0;
        ctx.fillStyle = "rgba(255,255,255,.96)";
        ctx.font = `500 26px ${serif}`;
        ctx.textAlign = "right";
        ctx.textBaseline = "middle";
        let s = c.name;
        while (ctx.measureText(s).width > R - 140 && s.length > 2) s = s.slice(0, -1);
        ctx.fillText(s === c.name ? s : `${s}…`, R - 34, 0);
        ctx.restore();
      });
      ctx.strokeStyle = "rgba(255,255,255,.55)";
      ctx.lineWidth = 1.5;
      for (let i = 0; i < N; i++) {
        const a = angle + i * seg;
        ctx.beginPath();
        ctx.moveTo(C + Math.cos(a) * R * 0.38, C + Math.sin(a) * R * 0.38);
        ctx.lineTo(C + Math.cos(a) * R, C + Math.sin(a) * R);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(C, C, R - 10, 0, TAU);
      ctx.strokeStyle = "rgba(255,255,255,.35)";
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = "rgba(255,255,255,.9)";
      for (let i = 0; i < N; i++) {
        const a = angle + i * seg;
        ctx.beginPath();
        ctx.arc(C + Math.cos(a) * (R - 10), C + Math.sin(a) * (R - 10), 3.5, 0, TAU);
        ctx.fill();
      }
      const s = segAtPointer();
      if (s !== lastSeg) {
        if (lastSeg !== -1) {
          sfx.tick();
          kick();
          if (Math.abs(vel) < 8) haptic(4);
        }
        lastSeg = s;
      }
    };

    const coast = () => {
      phase = "coast";
      setBusy(true);
      setHub("…");
      let t0 = performance.now();
      const step = (now: number) => {
        const dt = Math.min(0.05, (now - t0) / 1000);
        t0 = now;
        angle += vel * dt;
        vel *= Math.exp(-0.85 * dt);
        draw();
        if (Math.abs(vel) > 0.22) raf = requestAnimationFrame(step);
        else {
          phase = "done";
          setHub("✓");
          const winner = candidates[segAtPointer()];
          resultTimer = window.setTimeout(
            () => pickedRef.current(winner, hubRef.current),
            reduce ? 20 : 380,
          );
        }
      };
      raf = requestAnimationFrame(step);
    };

    const pAngle = (e: PointerEvent) => {
      const r = cv.getBoundingClientRect();
      return Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2));
    };
    const down = (e: PointerEvent) => {
      if (phase !== "idle") return;
      dragging = true;
      vel = 0;
      lastA = pAngle(e);
      lastT = e.timeStamp;
      cv.setPointerCapture(e.pointerId);
      sfx.tick();
    };
    const move = (e: PointerEvent) => {
      if (!dragging) return;
      const a = pAngle(e);
      let d = a - lastA;
      if (d > Math.PI) d -= TAU;
      if (d < -Math.PI) d += TAU;
      const dt = Math.max(1, e.timeStamp - lastT) / 1000;
      angle += d;
      vel = vel * 0.6 + (d / dt) * 0.4;
      lastA = a;
      lastT = e.timeStamp;
      draw();
    };
    const release = (e: PointerEvent) => {
      if (!dragging) return;
      dragging = false;
      if (e.timeStamp - lastT > 120) vel *= 0.15; // held still before letting go: no throw
      if (Math.abs(vel) > 4) {
        vel = Math.max(-28, Math.min(28, vel));
        sfx.whoosh();
        coast();
      } else {
        setHub("조금\n더 세게");
        haptic(8);
      }
    };
    spinRef.current = () => {
      if (phase !== "idle") return;
      vel = 14 + Math.random() * 8;
      sfx.whoosh();
      haptic(10);
      coast();
    };

    cv.addEventListener("pointerdown", down);
    cv.addEventListener("pointermove", move);
    cv.addEventListener("pointerup", release);
    cv.addEventListener("pointercancel", release);
    draw();
    void document.fonts?.ready.then(() => phase === "idle" && draw());
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(resultTimer);
      for (const im of photos) if (im) im.onload = null;
      cv.removeEventListener("pointerdown", down);
      cv.removeEventListener("pointermove", move);
      cv.removeEventListener("pointerup", release);
      cv.removeEventListener("pointercancel", release);
    };
  }, [candidates, indexOf]);

  return (
    <div className="center">
      <div className="wheel">
        <canvas
          ref={canvasRef}
          width={640}
          height={640}
          aria-label="룰렛. 잡고 돌리거나 아래 버튼을 눌러 줘"
        />
        <svg ref={flapRef} className="flapper" viewBox="0 0 22 34" aria-hidden="true">
          <path d="M11 34L1.5 8a9.5 9.5 0 1 1 19 0z" fill="var(--ink)" />
          <circle cx="11" cy="9" r="3" fill="var(--paper)" />
        </svg>
        <div className="hub" ref={hubRef}>
          {hub}
        </div>
      </div>
      <button className="btn ink" disabled={busy} onClick={() => spinRef.current()}>
        대신 돌려줘
      </button>
      <p className="hint">룰렛을 손가락으로 잡고 휙 돌려 줘</p>
    </div>
  );
}
