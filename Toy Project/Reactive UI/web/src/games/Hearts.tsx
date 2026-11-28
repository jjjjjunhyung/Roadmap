import { useRef, useState } from "react";

import { Tile } from "../components/ui";
import type { Place } from "../lib/api";
import { haptic, sfx } from "../lib/feel";
import { HEART, useLater } from "./kit";
import type { GameProps } from "./types";

const TOTAL = 10;

const Heart = ({ off = false }: { off?: boolean }) => (
  <svg className={`hrt${off ? " off" : ""}`} viewBox="0 0 24 24" aria-hidden="true">
    <path d={HEART} />
  </svg>
);

/**
 * Hand out ten hearts: as many as each place deserves. The most hearts wins; a tie asks once
 * more, between the tied.
 */
export function Hearts({ candidates, kind, indexOf, onPicked, onFocus }: GameProps) {
  const [given, setGiven] = useState<Record<string, number>>({});
  const [tie, setTie] = useState<Place[] | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const els = useRef<Record<string, HTMLElement | null>>({});
  const later = useLater();
  const count = (p: Place) => given[p.id] ?? 0;
  const left = TOTAL - Object.values(given).reduce((a, b) => a + b, 0);

  const add = (p: Place) => {
    if (done) return;
    if (tie) {
      if (!tie.some((t) => t.id === p.id)) return;
      finish(p);
      return;
    }
    if (left <= 0) {
      haptic(30);
      return;
    }
    setGiven((g) => ({ ...g, [p.id]: (g[p.id] ?? 0) + 1 }));
    onFocus?.([p.id]);
    sfx.pop();
    haptic(8);
  };
  const take = (p: Place) => {
    if (done || tie || !count(p)) return;
    setGiven((g) => ({ ...g, [p.id]: g[p.id] - 1 }));
    sfx.tick();
  };
  const finish = (p: Place) => {
    setDone(p.id);
    setTie(null);
    later(() => onPicked(p, els.current[p.id]), 800);
  };
  const decide = () => {
    const max = Math.max(...candidates.map(count));
    const top = candidates.filter((c) => count(c) === max);
    if (top.length === 1) {
      sfx.whoosh();
      finish(top[0]);
    } else {
      sfx.whoosh();
      haptic([10, 40, 10]);
      setTie(top);
      onFocus?.(top.map((t) => t.id));
    }
  };

  return (
    <div className="hearts">
      <div className="heart-bank" aria-live="polite">
        <span>{tie ? "동점이야! 하나만 더 골라 줘" : done ? "정해졌어" : `남은 하트 ${left}`}</span>
        <span className="heart-row-icons" aria-hidden="true">
          {Array.from({ length: TOTAL }, (_, i) => (
            <Heart key={i} off={i >= left} />
          ))}
        </span>
      </div>
      <ul className="heart-list">
        {candidates.map((p) => {
          const n = count(p);
          const inTie = !!tie?.some((t) => t.id === p.id);
          return (
            <li
              key={p.id}
              className={`heart-item${done === p.id ? " win" : done ? " lose" : ""}${tie && !inTie ? " lose" : ""}${inTie ? " tie" : ""}`}
            >
              <button
                ref={(el) => {
                  els.current[p.id] = el;
                }}
                className="heart-add"
                disabled={!!done || (!!tie && !inTie)}
                aria-label={`${p.name}에 하트 주기`}
                onClick={() => add(p)}
              >
                <Tile index={indexOf(p)} kind={kind} image={p.image_url} showIndex={false} />
                <span className="heart-what">
                  <b>{p.name}</b>
                  <span className="heart-given" aria-label={`하트 ${n}개`}>
                    {n ? Array.from({ length: n }, (_, i) => <Heart key={i} />) : "아직 0개"}
                  </span>
                </span>
              </button>
              {!tie && !done && n > 0 && (
                <button
                  className="heart-minus"
                  aria-label={`${p.name} 하트 하나 빼기`}
                  onClick={() => take(p)}
                >
                  −
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {!tie && !done && (
        <button className="btn accent heart-go" disabled={left > 0} onClick={decide}>
          {left > 0 ? `하트를 다 나눠 주면 정해져 (${left}개 남음)` : "이대로 정하기"}
        </button>
      )}
    </div>
  );
}
