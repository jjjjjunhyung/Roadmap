import { type CSSProperties, useEffect, useRef, useState } from "react";

import { Tile } from "../components/ui";
import { haptic, reducedMotion, sfx, shuffle } from "../lib/feel";
import { useLater, useLatest } from "./kit";
import type { GameProps } from "./types";

/**
 * A race between the places. Each runs at its own wobbling pace; tapping a lane cheers it on a
 * little (luck still decides). The first across the line wins.
 */
export function Race({ candidates, kind, indexOf, onPicked, onFocus }: GameProps) {
  const [deal] = useState(() => shuffle(candidates));
  const [phase, setPhase] = useState<"ready" | "count" | "run" | "done">("ready");
  const [count, setCount] = useState(3);
  const [winner, setWinner] = useState<number | null>(null);
  const runners = useRef<(HTMLElement | null)[]>([]);
  const boost = useRef<number[]>([]);
  const later = useLater();
  const picked = useLatest(onPicked);
  const focus = useLatest(onFocus);

  useEffect(() => {
    if (phase !== "run") return;
    const n = deal.length;
    const pos = deal.map(() => 0);
    boost.current = deal.map(() => 0);
    // every runner its own pace and wobble, so the lead changes hands
    const pace = deal.map(() => ({
      base: 0.15 + Math.random() * 0.035,
      a: 0.04 + Math.random() * 0.04,
      f: 1.2 + Math.random() * 2,
      ph: Math.random() * 6,
    }));
    let raf = 0;
    let last = 0;
    let t = 0;
    let leader = -1;
    const finish = (i: number) => {
      setWinner(i);
      setPhase("done");
      focus.current?.([deal[i].id]);
      sfx.thud();
      haptic([10, 30, 20]);
      later(() => picked.current(deal[i], runners.current[i]), 900);
    };
    if (reducedMotion()) {
      finish(Math.floor(Math.random() * n));
      return;
    }
    const frame = (now: number) => {
      const dt = Math.min(0.05, last ? (now - last) / 1000 : 0.016);
      last = now;
      t += dt;
      for (let i = 0; i < n; i++) {
        const p = pace[i];
        const b = boost.current[i];
        const v = Math.max(0.03, p.base + p.a * Math.sin(t * p.f + p.ph) + b);
        boost.current[i] = Math.max(0, b - 0.12 * dt);
        pos[i] = Math.min(1, pos[i] + v * dt);
        runners.current[i]?.style.setProperty("--p", pos[i].toFixed(4));
      }
      const lead = pos.indexOf(Math.max(...pos));
      if (lead !== leader) {
        leader = lead;
        focus.current?.([deal[lead].id]);
      }
      const won = pos.findIndex((x) => x >= 1);
      if (won >= 0) {
        finish(won);
        return;
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [phase, deal, later, picked, focus]);

  const start = () => {
    setPhase("count");
    sfx.tick();
    haptic(8);
    [2, 1].forEach((c, k) =>
      later(
        () => {
          setCount(c);
          sfx.tick();
          haptic(8);
        },
        (k + 1) * 650,
      ),
    );
    later(() => {
      setPhase("run");
      sfx.whoosh();
      haptic(20);
    }, 1950);
  };

  const cheer = (i: number) => {
    if (phase !== "run") return;
    const b = boost.current;
    b[i] = Math.min(0.07, (b[i] ?? 0) + 0.025);
    sfx.tick();
    haptic(4);
    const el = runners.current[i];
    if (el) {
      el.classList.remove("cheer");
      void el.offsetWidth;
      el.classList.add("cheer");
    }
  };

  return (
    <div className="race">
      <ol className="lanes">
        {deal.map((p, i) => (
          <li key={p.id}>
            <button
              type="button"
              className={`lane${winner === i ? " win" : winner !== null ? " lose" : ""}`}
              disabled={phase !== "run"}
              aria-label={`${p.name} 응원하기`}
              onPointerDown={() => cheer(i)}
            >
              <span className="lane-name">{p.name}</span>
              <span
                className="runner"
                ref={(el) => {
                  runners.current[i] = el;
                }}
                style={{ "--p": 0 } as CSSProperties}
              >
                <Tile index={indexOf(p)} kind={kind} image={p.image_url} showIndex={false} />
              </span>
            </button>
          </li>
        ))}
      </ol>
      {phase === "ready" && (
        <button className="btn accent race-go" onClick={start}>
          출발!
        </button>
      )}
      {phase === "count" && (
        <p key={count} className="race-count">
          {count}
        </p>
      )}
      <p className="hint">
        {phase === "run"
          ? "응원하는 줄을 톡톡 눌러 줘"
          : phase === "done"
            ? "1등으로 들어왔어!"
            : "누가 먼저 들어올까?"}
      </p>
    </div>
  );
}
