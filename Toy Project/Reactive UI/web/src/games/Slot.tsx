import { type PointerEvent, useEffect, useMemo, useRef, useState } from "react";

import { Tile } from "../components/ui";
import { haptic, reducedMotion, sfx, shuffle } from "../lib/feel";
import type { GameProps } from "./types";

const ROW = 74; // px per reel row; the payline is the middle of three
const REPS = 16; // how many times the candidates repeat on the reel
const PULL = 156; // px the lever ball travels

/** Pull the lever down (it resists); let go past the line to spin. The reel blurs, then settles. */
export function Slot({ candidates, indexOf, onPicked }: GameProps) {
  const [order] = useState(() => shuffle(candidates));
  const reel = useMemo(() => Array.from({ length: REPS }, () => order).flat(), [order]);
  const [phase, setPhase] = useState<"idle" | "fast" | "slow" | "done">("idle");
  const rowsRef = useRef<HTMLDivElement>(null);
  const ballRef = useRef<HTMLSpanElement>(null);
  const paylineRef = useRef<HTMLDivElement>(null);
  const used = useRef(false);
  const lever = useRef({ on: false, sy: 0, p: 0, moved: false, notch: 0 });
  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  const later = (f: () => void, ms: number) =>
    timers.current.push(window.setTimeout(f, reducedMotion() ? 20 : ms));
  const pull = (px: number) => ballRef.current?.style.setProperty("--pull", `${px}px`);

  const spin = () => {
    const rows = rowsRef.current;
    if (used.current || !rows) return;
    used.current = true;
    sfx.thud();
    haptic([25, 40, 25]);
    setPhase("fast");
    const target = Math.floor(Math.random() * order.length);
    const index = order.length * (REPS - 2) + target;
    const dur = reducedMotion() ? 100 : 3400;
    rows.style.transition = `transform ${dur}ms cubic-bezier(.12,.62,.08,1.03)`;
    rows.style.transform = `translateY(${ROW - index * ROW}px)`;
    let k = 0;
    const tick = () => {
      if (k++ >= 22) return;
      sfx.tick();
      later(tick, 60 + k * k * 0.55);
    };
    tick();
    later(() => setPhase("slow"), dur * 0.72);
    later(() => {
      setPhase("done");
      onPicked(order[target], paylineRef.current);
    }, dur + 250);
  };

  const down = (e: PointerEvent<HTMLButtonElement>) => {
    if (used.current) return;
    Object.assign(lever.current, { on: true, sy: e.clientY, p: 0, moved: false, notch: 0 });
    e.currentTarget.setPointerCapture(e.pointerId);
    e.currentTarget.classList.add("dragging");
  };
  const move = (e: PointerEvent<HTMLButtonElement>) => {
    const l = lever.current;
    if (!l.on) return;
    const d = Math.max(0, e.clientY - l.sy);
    if (d > 4) l.moved = true;
    l.p = 1 - Math.exp(-d / 110); // resists more the further it goes
    pull(l.p * PULL);
    const notch = Math.floor(l.p * 8);
    if (notch > l.notch) {
      sfx.tick();
      haptic(3);
    }
    l.notch = notch;
  };
  const up = (e: PointerEvent<HTMLButtonElement>) => {
    const l = lever.current;
    if (!l.on) return;
    l.on = false;
    e.currentTarget.classList.remove("dragging");
    pull(0);
    if (l.p > 0.72) spin();
    else if (l.moved) haptic(8);
  };
  // a plain tap (or Enter) pulls it for you
  const click = () => {
    if (lever.current.moved) {
      lever.current.moved = false;
      return;
    }
    if (used.current) return;
    pull(PULL);
    later(() => pull(0), 220);
    spin();
  };

  const running = phase === "fast" || phase === "slow";
  return (
    <div className="center">
      <div className="slot">
        <div className={`cabinet${running ? " running" : ""}`}>
          <Bulbs />
          <div className="reel">
            <div className="payline" ref={paylineRef} aria-hidden="true" />
            <div
              className={`rows${phase === "fast" ? " blur" : ""}`}
              ref={rowsRef}
              // start one lap in, so the rows above the payline are filled too
              style={{ transform: `translateY(${ROW - order.length * ROW}px)` }}
            >
              {reel.map((p, i) => (
                <div key={i} aria-hidden={i < order.length || i >= order.length * 2}>
                  <Tile index={indexOf(p)} showIndex={false} image={p.image_url} />
                  <span>{p.name}</span>
                </div>
              ))}
            </div>
          </div>
          <Bulbs />
        </div>
        <button
          className="lever"
          aria-label="레버 당기기"
          disabled={phase !== "idle"}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
          onClick={click}
        >
          <span className="track" />
          <span className="knobball" ref={ballRef} />
          <span className="base" />
        </button>
      </div>
      <p className="hint">오른쪽 레버를 끝까지 당겨 줘</p>
    </div>
  );
}

function Bulbs() {
  return (
    <div className="bulbs" aria-hidden="true">
      {Array.from({ length: 11 }, (_, i) => (
        <i key={i} />
      ))}
    </div>
  );
}
