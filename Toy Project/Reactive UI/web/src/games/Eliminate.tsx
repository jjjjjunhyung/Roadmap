import { useEffect, useRef, useState } from "react";

import { Tile } from "../components/ui";
import type { Place } from "../lib/api";
import { haptic, sfx } from "../lib/feel";
import { useLater } from "./kit";
import type { GameProps } from "./types";

/** Cross out the least tempting place, one at a time; the last one standing wins. */
export function Eliminate({ candidates, kind, indexOf, onPicked, onFocus }: GameProps) {
  const [out, setOut] = useState<string[]>([]);
  const els = useRef<Record<string, HTMLButtonElement | null>>({});
  const later = useLater();
  const left = candidates.filter((c) => !out.includes(c.id));
  const over = left.length === 1;

  useEffect(() => {
    onFocus?.(candidates.filter((c) => !out.includes(c.id)).map((c) => c.id));
  }, [out, candidates, onFocus]);

  const strike = (p: Place) => {
    if (over || out.includes(p.id)) return;
    const next = [...out, p.id];
    setOut(next);
    sfx.thud();
    haptic(22);
    const rest = candidates.filter((c) => !next.includes(c.id));
    if (rest.length === 1) later(() => onPicked(rest[0], els.current[rest[0].id]), 900);
  };

  return (
    <div className="elim">
      <ul className="elim-grid">
        {candidates.map((p) => {
          const gone = out.includes(p.id);
          return (
            <li key={p.id}>
              <button
                ref={(el) => {
                  els.current[p.id] = el;
                }}
                className={`elim-card${gone ? " out" : ""}${over && !gone ? " win" : ""}`}
                disabled={gone || over}
                aria-label={gone ? `${p.name} (지움)` : `${p.name} 지우기`}
                onClick={() => strike(p)}
              >
                <Tile index={indexOf(p)} kind={kind} name={p.name} image={p.image_url} />
                <span className="elim-x" aria-hidden="true" />
              </button>
            </li>
          );
        })}
      </ul>
      <div className="elim-foot">
        <p className="hint">
          {over ? "마지막까지 남은 곳!" : `제일 안 끌리는 곳부터 지워 줘 · 남은 곳 ${left.length}`}
        </p>
        {out.length > 0 && !over && (
          <button
            className="btn small ghost"
            onClick={() => {
              sfx.tick();
              setOut((o) => o.slice(0, -1));
            }}
          >
            하나 되돌리기
          </button>
        )}
      </div>
    </div>
  );
}
