import { type CSSProperties, useEffect, useRef, useState } from "react";

import { Tile } from "../components/ui";
import { haptic, reducedMotion, sfx, shuffle } from "../lib/feel";
import { useLater, useLatest } from "./kit";
import type { GameProps } from "./types";

/** Tries before the claw stops being shy and takes the nearest prize. */
const SURE = 4;

/**
 * A claw machine: the claw sways over the prizes; press to drop it. A good drop may still slip
 * (luck), and a miss costs nothing but another go.
 */
export function Crane({ candidates, kind, indexOf, onPicked, onFocus }: GameProps) {
  const [deal] = useState(() => shuffle(candidates));
  const [phase, setPhase] = useState<"move" | "drop" | "up" | "done">("move");
  const [grabbed, setGrabbed] = useState<number | null>(null);
  const [slipped, setSlipped] = useState<number | null>(null);
  const [tries, setTries] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const claw = useRef<HTMLDivElement>(null);
  const clawX = useRef(0.5);
  const prizes = useRef<(HTMLLIElement | null)[]>([]);
  const later = useLater();
  const picked = useLatest(onPicked);
  const n = deal.length;
  // prize centres across the floor, 0..1
  const at = (i: number) => (i + 0.5) / n;

  useEffect(() => {
    if (phase !== "move") return;
    let raf = 0;
    const t0 =
      performance.now() - Math.asin(Math.max(-1, Math.min(1, (clawX.current - 0.5) / 0.42))) * 1000;
    const frame = (now: number) => {
      const x = 0.5 + 0.42 * Math.sin((now - t0) / 1000);
      clawX.current = x;
      claw.current?.style.setProperty("--x", x.toFixed(4));
      raf = requestAnimationFrame(frame);
    };
    if (!reducedMotion()) raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [phase]);

  const drop = () => {
    if (phase !== "move") return;
    const attempt = tries + 1;
    setTries(attempt);
    setSlipped(null);
    let x = clawX.current;
    let near = 0;
    for (let i = 1; i < n; i++) if (Math.abs(at(i) - x) < Math.abs(at(near) - x)) near = i;
    const close = Math.abs(at(near) - x) < 0.42 / n + 0.02;
    // after a few tries the claw stops being shy: it goes over the nearest prize and holds on
    const sure = attempt >= SURE;
    if (sure) {
      x = at(near);
      clawX.current = x;
      claw.current?.style.setProperty("--x", x.toFixed(4));
    }
    const holds = sure || (close && Math.random() < 0.72);
    setPhase("drop");
    sfx.whoosh();
    haptic(10);
    later(() => {
      sfx.tick();
      haptic(16);
      if (holds) {
        setGrabbed(near);
        onFocus?.([deal[near].id]);
      } else if (close) setSlipped(near);
      setPhase("up");
    }, 900);
    later(() => {
      if (holds) {
        setPhase("done");
        sfx.pop();
        haptic([10, 30, 20]);
        later(() => picked.current(deal[near], prizes.current[near]), 500);
      } else {
        sfx.thud();
        setPhase("move");
      }
    }, 1900);
  };

  return (
    <div className="crane">
      <div className={`crane-box ${phase}`} ref={box} style={{ "--n": n } as CSSProperties}>
        <div className="claw" ref={claw} style={{ "--x": 0.5 } as CSSProperties}>
          <span className="cable" />
          <span className="head">
            <i className="arm l" />
            <i className="arm r" />
          </span>
        </div>
        <ul className="prizes">
          {deal.map((p, i) => (
            <li
              key={p.id}
              ref={(el) => {
                prizes.current[i] = el;
              }}
              className={`prize${grabbed === i ? " held" : ""}${slipped === i ? " slip" : ""}`}
              style={{ "--i": i, "--x": at(i) } as CSSProperties}
            >
              <Tile index={indexOf(p)} kind={kind} image={p.image_url} showIndex={false} />
              <span>{p.name}</span>
            </li>
          ))}
        </ul>
      </div>
      {phase === "move" && (
        <button className="btn accent crane-go" onClick={drop}>
          내리기
        </button>
      )}
      <p className="hint">
        {phase === "done"
          ? "뽑았다!"
          : phase !== "move"
            ? "두근두근…"
            : tries === 0
              ? "집게가 원하는 위에 올 때 눌러 줘"
              : slipped !== null
                ? "아깝다, 미끄러졌어! 한 번 더"
                : "놓쳤어! 한 번 더"}
      </p>
    </div>
  );
}
