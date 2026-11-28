import { useRef, useState } from "react";

import { Tile } from "../components/ui";
import type { Place } from "../lib/api";
import { haptic, sfx } from "../lib/feel";
import { useLater } from "./kit";
import type { GameProps } from "./types";

/** Tap the places in order of how much you want them: 1st, 2nd, …; the 1st wins. */
export function Rank({ candidates, kind, indexOf, onPicked, onFocus }: GameProps) {
  const [order, setOrder] = useState<string[]>([]);
  const els = useRef<Record<string, HTMLButtonElement | null>>({});
  const later = useLater();
  const n = candidates.length;
  const done = order.length === n;

  const tap = (p: Place) => {
    if (done || order.includes(p.id)) return;
    let next = [...order, p.id];
    // the last one ranks itself
    if (next.length === n - 1) {
      const last = candidates.find((c) => !next.includes(c.id));
      if (last) next = [...next, last.id];
    }
    setOrder(next);
    onFocus?.([p.id]);
    sfx.tick();
    haptic(8);
    if (next.length === n) {
      const first = next[0];
      const place = candidates.find((c) => c.id === first);
      if (place) later(() => onPicked(place, els.current[first]), 1200);
    }
  };

  return (
    <div className="rank">
      <ul className="rank-grid">
        {candidates.map((p) => {
          const r = order.indexOf(p.id);
          return (
            <li key={p.id}>
              <button
                ref={(el) => {
                  els.current[p.id] = el;
                }}
                className={`rank-card${r >= 0 ? " ranked" : ""}${done && r === 0 ? " first" : ""}`}
                disabled={r >= 0 || done}
                aria-label={
                  r >= 0 ? `${p.name} ${r + 1}등` : `${p.name}를 ${order.length + 1}등으로`
                }
                onClick={() => tap(p)}
              >
                <Tile
                  index={indexOf(p)}
                  kind={kind}
                  name={p.name}
                  image={p.image_url}
                  showIndex={false}
                />
                {r >= 0 && <span className="rank-badge">{r + 1}등</span>}
              </button>
            </li>
          );
        })}
      </ul>
      <div className="elim-foot">
        <p className="hint">
          {done
            ? "순위가 정해졌어"
            : order.length === 0
              ? "제일 가고 싶은 곳부터 차례로 눌러 줘"
              : `${order.length + 1}등은?`}
        </p>
        {order.length > 0 && !done && (
          <button
            className="btn small ghost"
            onClick={() => {
              sfx.tick();
              setOrder((o) => o.slice(0, -1));
            }}
          >
            하나 되돌리기
          </button>
        )}
      </div>
    </div>
  );
}
