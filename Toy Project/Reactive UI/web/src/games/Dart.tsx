import { type CSSProperties, useEffect, useRef, useState } from "react";

import { Tile } from "../components/ui";
import { haptic, reducedMotion, sfx, shuffle } from "../lib/feel";
import { aura } from "../lib/look";
import { useLater, useLatest } from "./kit";
import type { GameProps } from "./types";

const S = 300;
const C = S / 2;
const R = 140;
const TAU = Math.PI * 2;

/** One wedge of the board, clockwise from the top. */
function wedge(i: number, n: number) {
  const a0 = (i / n) * TAU - Math.PI / 2;
  const a1 = ((i + 1) / n) * TAU - Math.PI / 2;
  const p = (a: number) => `${C + R * Math.cos(a)} ${C + R * Math.sin(a)}`;
  return `M ${C} ${C} L ${p(a0)} A ${R} ${R} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${p(a1)} Z`;
}

/** Darts: the sight drifts over the board; throw when it feels right (the dart wobbles a bit). */
export function Dart({ candidates, kind, indexOf, onPicked, onFocus }: GameProps) {
  const [deal] = useState(() => shuffle(candidates));
  const [hit, setHit] = useState<number | null>(null);
  const [thrown, setThrown] = useState(false);
  const sight = useRef<HTMLSpanElement>(null);
  const dart = useRef<HTMLSpanElement>(null);
  const board = useRef<HTMLDivElement>(null);
  const aimAt = useRef({ x: 0, y: 0 });
  const later = useLater();
  const picked = useLatest(onPicked);
  const n = deal.length;

  // the sight wanders over the board until the throw
  useEffect(() => {
    if (thrown) return;
    let raf = 0;
    const t0 = performance.now();
    const frame = (now: number) => {
      const t = (now - t0) / 1000;
      const x = 0.72 * Math.sin(t * 1.7);
      const y = 0.72 * Math.sin(t * 2.3 + 1.1);
      aimAt.current = { x, y };
      sight.current?.style.setProperty("--x", x.toFixed(4));
      sight.current?.style.setProperty("--y", y.toFixed(4));
      raf = requestAnimationFrame(frame);
    };
    if (!reducedMotion()) raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [thrown]);

  const throwDart = () => {
    if (thrown) return;
    setThrown(true);
    sfx.whoosh();
    haptic(10);
    // where it lands: the sight, plus a wobble, always on the board
    let { x, y } = aimAt.current;
    x += (Math.random() + Math.random() - 1) * 0.16;
    y += (Math.random() + Math.random() - 1) * 0.16;
    const d = Math.hypot(x, y);
    if (d > 0.93) {
      x *= 0.93 / d;
      y *= 0.93 / d;
    }
    const el = dart.current;
    if (el) {
      el.style.setProperty("--x", x.toFixed(4));
      el.style.setProperty("--y", y.toFixed(4));
      el.classList.add("fly");
    }
    const a = (Math.atan2(x, -y) + TAU) % TAU;
    const i = Math.min(n - 1, Math.floor((a / TAU) * n));
    later(() => {
      setHit(i);
      onFocus?.([deal[i].id]);
      sfx.thud();
      haptic([14, 30, 10]);
    }, 480);
    later(() => picked.current(deal[i], board.current), 1300);
  };

  return (
    <div className="dart">
      <div className="dart-board" ref={board}>
        <svg viewBox={`0 0 ${S} ${S}`} aria-hidden="true">
          {deal.map((p, i) => {
            const mid = ((i + 0.5) / n) * TAU - Math.PI / 2;
            return (
              <g key={p.id} className={hit === i ? "hit" : hit !== null ? "miss" : ""}>
                <path d={wedge(i, n)} fill={aura(indexOf(p))[0]} />
                <text x={C + R * 0.68 * Math.cos(mid)} y={C + R * 0.68 * Math.sin(mid) + 6}>
                  {i + 1}
                </text>
              </g>
            );
          })}
          <circle cx={C} cy={C} r={R * 0.16} className="bull" />
        </svg>
        <span className="sight" ref={sight} style={{ "--x": 0, "--y": 0 } as CSSProperties} />
        <span className="dart-pin" ref={dart} aria-hidden="true" />
      </div>
      <ol className="dart-legend">
        {deal.map((p, i) => (
          <li key={p.id} className={hit === i ? "hit" : ""}>
            <span className="no">{i + 1}</span>
            <Tile index={indexOf(p)} kind={kind} image={p.image_url} showIndex={false} />
            <span className="nm">{p.name}</span>
          </li>
        ))}
      </ol>
      {!thrown && (
        <button className="btn accent dart-go" onClick={throwDart}>
          던지기
        </button>
      )}
      <p className="hint">
        {hit !== null ? `${hit + 1}번에 꽂혔어!` : thrown ? "슝—" : "조준점이 마음에 들 때 던져 줘"}
      </p>
    </div>
  );
}
