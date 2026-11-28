import { useEffect, useRef, useState } from "react";

import { Tile } from "../components/ui";
import { haptic, reducedMotion, sfx, shuffle } from "../lib/feel";
import { cssVar, useLater, useLatest } from "./kit";
import type { GameProps } from "./types";

const H = 400;
const SLOT_H = 64;
const BALL = 8;
const PEG = 3.5;

/**
 * Plinko: drop a ball from wherever you like along the top; it bounces down through the pegs
 * into one of the places' slots.
 */
export function Plinko({ candidates, kind, indexOf, onPicked, onFocus }: GameProps) {
  const [deal] = useState(() => shuffle(candidates));
  const [landed, setLanded] = useState<number | null>(null);
  const [falling, setFalling] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const slots = useRef<(HTMLLIElement | null)[]>([]);
  const dropRef = useRef<(x: number) => void>(() => {});
  const later = useLater();
  const picked = useLatest(onPicked);
  const focus = useLatest(onFocus);

  useEffect(() => {
    const cv = canvas.current;
    const ctx = cv?.getContext("2d");
    if (!cv || !ctx) return;
    const n = deal.length;
    const W = cv.parentElement?.clientWidth ?? 320;
    const dpr = Math.min(2, devicePixelRatio || 1);
    cv.width = Math.round(W * dpr);
    cv.height = Math.round(H * dpr);
    cv.style.width = `${W}px`;
    cv.style.height = `${H}px`;
    ctx.scale(dpr, dpr);
    const ink = cssVar(cv, "--ink-2") || "#454b57";
    const line = cssVar(cv, "--line") || "#d9dde4";
    const accent = cssVar(cv, "--accent") || "#9b1c34";

    // staggered pegs above the slots
    const pegs: [number, number][] = [];
    const dx = W / 8;
    for (let r = 0, y = 70; y < H - SLOT_H - 22; r++, y += 34) {
      for (let x = dx / 2 + (r % 2 ? dx / 2 : 0); x < W - 4; x += dx) pegs.push([x, y]);
    }
    const slotW = W / n;
    const ball = { x: W / 2, y: 22, vx: 0, vy: 0 };
    let phase: "aim" | "fall" | "done" = "aim";
    let raf = 0;
    let last = 0;
    let started = 0;
    let lastTick = 0;

    const draw = () => {
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = ink;
      for (const [x, y] of pegs) {
        ctx.beginPath();
        ctx.arc(x, y, PEG, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.strokeStyle = line;
      ctx.lineWidth = 2;
      for (let i = 1; i < n; i++) {
        ctx.beginPath();
        ctx.moveTo(i * slotW, H - SLOT_H);
        ctx.lineTo(i * slotW, H);
        ctx.stroke();
      }
      if (phase === "aim") {
        ctx.setLineDash([3, 5]);
        ctx.strokeStyle = accent;
        ctx.beginPath();
        ctx.moveTo(ball.x, ball.y);
        ctx.lineTo(ball.x, ball.y + 34);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      const g = ctx.createRadialGradient(ball.x - 3, ball.y - 3, 1, ball.x, ball.y, BALL);
      g.addColorStop(0, "#ffffff");
      g.addColorStop(0.35, accent);
      g.addColorStop(1, accent);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(ball.x, ball.y, BALL, 0, Math.PI * 2);
      ctx.fill();
    };

    const land = () => {
      phase = "done";
      const i = Math.max(0, Math.min(n - 1, Math.floor(ball.x / slotW)));
      setLanded(i);
      focus.current?.([deal[i].id]);
      sfx.thud();
      haptic([10, 30, 20]);
      later(() => picked.current(deal[i], slots.current[i]), 800);
    };

    const step = (dt: number) => {
      ball.vy += 1100 * dt;
      ball.x += ball.vx * dt;
      ball.y += ball.vy * dt;
      for (const [px, py] of pegs) {
        const ddx = ball.x - px;
        const ddy = ball.y - py;
        const d = Math.hypot(ddx, ddy);
        if (d > 0 && d < BALL + PEG) {
          const nx = ddx / d;
          const ny = ddy / d;
          ball.x = px + nx * (BALL + PEG);
          ball.y = py + ny * (BALL + PEG);
          const vn = ball.vx * nx + ball.vy * ny;
          if (vn < 0) {
            ball.vx -= 1.5 * vn * nx;
            ball.vy -= 1.5 * vn * ny;
            ball.vx += (Math.random() - 0.5) * 70;
            const now = performance.now();
            if (now - lastTick > 60) {
              sfx.tick();
              lastTick = now;
            }
          }
        }
      }
      if (ball.x < BALL) {
        ball.x = BALL;
        ball.vx = Math.abs(ball.vx) * 0.6;
      } else if (ball.x > W - BALL) {
        ball.x = W - BALL;
        ball.vx = -Math.abs(ball.vx) * 0.6;
      }
      if (ball.y > H - SLOT_H - BALL) {
        for (let i = 1; i < n; i++) {
          const xd = i * slotW;
          if (Math.abs(ball.x - xd) < BALL) {
            ball.x = xd + Math.sign(ball.x - xd || 1) * BALL;
            ball.vx = -ball.vx * 0.5;
          }
        }
      }
      const sp = Math.hypot(ball.vx, ball.vy);
      if (sp > 900) {
        ball.vx *= 900 / sp;
        ball.vy *= 900 / sp;
      }
    };

    const frame = (t: number) => {
      const dt = Math.min(0.033, last ? (t - last) / 1000 : 0.016);
      last = t;
      for (let k = 0; k < 4; k++) step(dt / 4);
      if (ball.y >= H - BALL - 2 || t - started > 9000) {
        ball.y = Math.min(ball.y, H - BALL - 2);
        draw();
        land();
        return;
      }
      draw();
      raf = requestAnimationFrame(frame);
    };

    dropRef.current = (x: number) => {
      if (phase !== "aim") return;
      ball.x = Math.max(BALL + 2, Math.min(W - BALL - 2, x));
      ball.vx = (Math.random() - 0.5) * 30;
      phase = "fall";
      setFalling(true);
      sfx.whoosh();
      haptic(12);
      if (reducedMotion()) {
        ball.x = (Math.floor(Math.random() * n) + 0.5) * slotW;
        ball.y = H - BALL - 2;
        draw();
        land();
        return;
      }
      started = performance.now();
      raf = requestAnimationFrame(frame);
    };
    const aim = (e: PointerEvent) => {
      if (phase !== "aim") return;
      const r = cv.getBoundingClientRect();
      ball.x = Math.max(BALL + 2, Math.min(W - BALL - 2, e.clientX - r.left));
      draw();
    };
    cv.addEventListener("pointermove", aim);
    draw();
    return () => {
      cancelAnimationFrame(raf);
      cv.removeEventListener("pointermove", aim);
    };
  }, [deal, later, picked, focus]);

  return (
    <div className="plinko">
      <div className="plinko-board">
        <canvas
          ref={canvas}
          aria-label="공을 떨어뜨릴 자리를 눌러 줘"
          onPointerDown={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            dropRef.current(e.clientX - r.left);
          }}
        />
        <ol
          className="plinko-slots"
          style={{ gridTemplateColumns: `repeat(${deal.length}, minmax(0, 1fr))` }}
        >
          {deal.map((p, i) => (
            <li
              key={p.id}
              ref={(el) => {
                slots.current[i] = el;
              }}
              className={landed === i ? "hit" : landed !== null ? "miss" : ""}
            >
              <Tile index={indexOf(p)} kind={kind} image={p.image_url} showIndex={false} />
              <span>{p.name}</span>
            </li>
          ))}
        </ol>
      </div>
      <p className="hint">
        {landed !== null
          ? "여기 들어갔어!"
          : falling
            ? "떼구르르…"
            : "공을 떨어뜨릴 자리를 눌러 줘"}
      </p>
    </div>
  );
}
