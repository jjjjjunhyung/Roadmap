import { type CSSProperties, type PointerEvent, useEffect, useRef, useState } from "react";

import type { Place } from "../lib/api";
import { haptic, reducedMotion, sfx } from "../lib/feel";
import { auraBase } from "../lib/look";
import type { GameProps } from "./types";

// dome geometry (px): capsules live inside a circle that ends in a flat floor
const WD = 224;
const HD = 204;
const CX = WD / 2;
const CY = 103;
const R = 100;
const r = 19;
const COUNT = 11;
const TURN = Math.PI * 1.8; // how far the knob must go before a capsule drops
const STEP = 1000 / 60; // fixed physics step (ms), so 120 Hz screens don't run double speed

/** Where a capsule starts; fixed for the life of the game. */
interface Cap {
  place: Place;
  x: number;
  y: number;
  a: number;
}
/** Live physics state, mutated every frame outside React. */
interface Body {
  x: number;
  y: number;
  vx: number;
  vy: number;
  a: number;
  gone: boolean;
}

/** Capsules tumble with real-ish physics. Tap the dome to rattle them; turn the knob a full circle. */
export function Gacha({ candidates, indexOf, onPicked }: GameProps) {
  const [pick] = useState(() => candidates[Math.floor(Math.random() * candidates.length)]);
  // capsule 0 is the one that comes out
  const [caps] = useState<Cap[]>(() =>
    Array.from({ length: COUNT }, (_, i) => ({
      place: i === 0 ? pick : candidates[i % candidates.length],
      x: CX + (Math.random() - 0.5) * 100,
      y: 40 + Math.random() * 60,
      a: Math.random() * 6,
    })),
  );
  const nodes = useRef<(HTMLSpanElement | null)[]>([]);
  const [phase, setPhase] = useState<"idle" | "out" | "open">("idle");
  const knobRef = useRef<HTMLButtonElement>(null);
  const meterRef = useRef<HTMLElement>(null);
  const dropRef = useRef<HTMLButtonElement>(null);
  // the physics loop lives in an effect; handlers reach it through these
  const ctl = useRef({ rattle: (_power: number) => {}, takeOut: () => {} });
  const turn = useRef({ on: false, last: 0, total: 0, dispensed: false });
  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  const later = (f: () => void, ms: number) =>
    timers.current.push(window.setTimeout(f, reducedMotion() ? 20 : ms));

  // physics: runs while something is moving, then sleeps until the next rattle
  useEffect(() => {
    const bodies: Body[] = caps.map((c) => ({
      x: c.x,
      y: c.y,
      vx: (Math.random() - 0.5) * 2,
      vy: 0,
      a: c.a,
      gone: false,
    }));
    let raf = 0;
    let acc = 0;
    let prev = 0;
    let quietUntil = 0;
    const tick = () => {
      for (const c of bodies) {
        if (c.gone) continue;
        c.vy += 0.35;
        c.vx *= 0.995;
        c.vy *= 0.995;
        c.x += c.vx;
        c.y += c.vy;
        c.a += c.vx * 0.05;
        const dx = c.x - CX;
        const dy = c.y - CY;
        const d = Math.hypot(dx, dy);
        const max = R - r;
        if (d > max) {
          const nx = dx / d;
          const ny = dy / d;
          c.x = CX + nx * max;
          c.y = CY + ny * max;
          const dot = c.vx * nx + c.vy * ny;
          if (dot > 0) {
            c.vx -= 1.4 * dot * nx;
            c.vy -= 1.4 * dot * ny;
          }
          c.vx *= 0.97; // glass is a little grippy
        }
        if (c.y > HD - r - 4) {
          c.y = HD - r - 4;
          c.vy *= -0.3;
          c.vx *= 0.94;
        }
      }
      for (let i = 0; i < bodies.length; i++) {
        const a = bodies[i];
        if (a.gone) continue;
        for (let j = i + 1; j < bodies.length; j++) {
          const b = bodies[j];
          if (b.gone) continue;
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const d = Math.hypot(dx, dy) || 0.01;
          if (d >= r * 2) continue;
          const o = (r * 2 - d) / 2;
          const nx = dx / d;
          const ny = dy / d;
          a.x -= nx * o;
          a.y -= ny * o;
          b.x += nx * o;
          b.y += ny * o;
          const rv = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
          if (rv < 0) {
            const imp = -rv * 0.6;
            a.vx -= imp * nx;
            a.vy -= imp * ny;
            b.vx += imp * nx;
            b.vy += imp * ny;
          }
        }
      }
    };
    const frame = (now: number) => {
      acc += Math.min(100, now - prev);
      prev = now;
      for (let k = 0; acc >= STEP && k < 4; k++, acc -= STEP) tick();
      acc %= STEP;
      bodies.forEach((c, i) => {
        const node = nodes.current[i];
        if (node && !c.gone)
          node.style.transform = `translate(${c.x - r}px, ${c.y - r}px) rotate(${c.a}rad)`;
      });
      raf = now < quietUntil ? requestAnimationFrame(frame) : 0;
    };
    const wake = () => {
      quietUntil = performance.now() + 3500;
      if (raf) return;
      prev = performance.now();
      raf = requestAnimationFrame(frame);
    };
    ctl.current = {
      rattle: (power) => {
        for (const c of bodies) {
          c.vx += (Math.random() - 0.5) * 9 * power;
          c.vy -= (3 + Math.random() * 7) * power;
        }
        wake();
      },
      takeOut: () => {
        bodies[0].gone = true;
        const node = nodes.current[0];
        if (node) node.style.display = "none";
      },
    };
    wake();
    return () => cancelAnimationFrame(raf);
  }, [caps]);

  const rattle = (power = 1) => ctl.current.rattle(power);

  const setTurn = (t: number) => {
    turn.current.total = t;
    knobRef.current?.style.setProperty("--turn", `${t}rad`);
    if (meterRef.current) meterRef.current.style.width = `${Math.min(1, t / TURN) * 100}%`;
  };

  const dispense = () => {
    if (turn.current.dispensed) return;
    turn.current.dispensed = true;
    sfx.thud();
    haptic([20, 40, 20]);
    rattle(1.4);
    ctl.current.takeOut();
    later(() => {
      setPhase("out");
      sfx.pop();
    }, 650);
  };

  const knobAngle = (e: PointerEvent) => {
    const b = knobRef.current!.getBoundingClientRect();
    return Math.atan2(e.clientY - (b.top + b.height / 2), e.clientX - (b.left + b.width / 2));
  };
  const down = (e: PointerEvent<HTMLButtonElement>) => {
    if (turn.current.dispensed) return;
    turn.current.on = true;
    turn.current.last = knobAngle(e);
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const move = (e: PointerEvent<HTMLButtonElement>) => {
    const t = turn.current;
    if (!t.on) return;
    const a = knobAngle(e);
    let d = a - t.last;
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    t.last = a;
    if (d > 0) {
      const before = Math.floor(t.total / 0.5);
      setTurn(t.total + d);
      if (Math.floor(t.total / 0.5) > before) {
        sfx.tick();
        haptic(3);
        rattle(0.25);
      }
    }
    if (t.total >= TURN) {
      t.on = false;
      setTurn(Math.PI * 2);
      dispense();
    }
  };
  const stop = () => {
    turn.current.on = false;
  };
  // a plain tap (or Enter) turns it for you
  const click = () => {
    const t = turn.current;
    if (t.dispensed || t.total > 0.3) return;
    const t0 = performance.now();
    const from = t.total;
    const dur = reducedMotion() ? 1 : 900;
    const anim = (now: number) => {
      const p = Math.min(1, (now - t0) / dur);
      setTurn(from + (Math.PI * 2 - from) * (1 - (1 - p) ** 3));
      if (p < 1) requestAnimationFrame(anim);
      else dispense();
    };
    requestAnimationFrame(anim);
    rattle(0.6);
  };

  const open = () => {
    if (phase !== "out") return;
    setPhase("open");
    sfx.pop();
    haptic(16);
    later(() => onPicked(pick, dropRef.current), 450);
  };

  return (
    <div className="gacha">
      <div className="machine">
        <div
          className="dome"
          aria-hidden="true"
          onPointerDown={() => {
            rattle(1);
            sfx.tick();
            haptic(8);
          }}
        >
          {caps.map((c, i) => (
            <span
              key={i}
              className="capsule"
              style={
                {
                  "--cc": auraBase(indexOf(c.place)),
                  transform: `translate(${c.x - r}px, ${c.y - r}px) rotate(${c.a}rad)`,
                } as CSSProperties
              }
              ref={(el) => {
                nodes.current[i] = el;
              }}
            />
          ))}
        </div>
        <div className="base2">
          <button
            ref={knobRef}
            className="knob"
            aria-label="손잡이 돌리기"
            disabled={phase !== "idle"}
            onPointerDown={down}
            onPointerMove={move}
            onPointerUp={stop}
            onPointerCancel={stop}
            onClick={click}
          />
          <div className="chute">
            {phase !== "idle" && (
              <button
                ref={dropRef}
                className={`drop${phase === "open" ? " open" : ""}`}
                style={{ "--cc": auraBase(indexOf(pick)) } as CSSProperties}
                aria-label="캡슐 열기"
                onClick={open}
              >
                <span className="h ht" />
                <span className="h hb" />
              </button>
            )}
          </div>
        </div>
      </div>
      <div className="meter" aria-hidden="true">
        <i ref={meterRef} />
      </div>
      <p className="hint">
        {phase === "idle"
          ? "손잡이를 잡고 한 바퀴 돌려 줘 · 통을 톡 치면 흔들려"
          : "나온 캡슐을 눌러서 열어 봐"}
      </p>
    </div>
  );
}
