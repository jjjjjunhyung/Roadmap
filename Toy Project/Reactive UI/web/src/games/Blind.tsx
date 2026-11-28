import { useRef, useState } from "react";

import { Tile } from "../components/ui";
import { haptic, sfx, shuffle } from "../lib/feel";
import { useLater } from "./kit";
import type { GameProps } from "./types";

/**
 * Blind pick: no names, no photos, only the planner's note as a hint (and a work's time). Tap a
 * card, tap again to open it; the rest turn over after.
 */
export function Blind({ candidates, kind, indexOf, onPicked }: GameProps) {
  const [deal] = useState(() => shuffle(candidates));
  const [armed, setArmed] = useState<number | null>(null);
  const [opened, setOpened] = useState<number | null>(null);
  const [all, setAll] = useState(false);
  const els = useRef<(HTMLButtonElement | null)[]>([]);
  const later = useLater();

  const tap = (i: number) => {
    if (opened !== null) return;
    if (armed !== i) {
      setArmed(i);
      sfx.tick();
      haptic(6);
      return;
    }
    setOpened(i);
    sfx.whoosh();
    haptic([10, 30, 16]);
    later(() => setAll(true), 1000);
    later(() => onPicked(deal[i], els.current[i]), 1700);
  };

  return (
    <div className="blind">
      <ul className="blind-grid">
        {deal.map((p, i) => {
          const open = opened === i || all;
          return (
            <li key={p.id}>
              <button
                ref={(el) => {
                  els.current[i] = el;
                }}
                className={`blind-card${armed === i ? " armed" : ""}${open ? " open" : ""}${all && opened !== i ? " dim" : ""}`}
                disabled={opened !== null}
                aria-label={`${String.fromCharCode(65 + i)} 카드: ${p.memo || "힌트 없음"}`}
                onClick={() => tap(i)}
              >
                <span className="blind-cover">
                  <span className="blind-no">{String.fromCharCode(65 + i)}</span>
                  <span className={`blind-hint${p.memo ? "" : " none"}`}>
                    {p.memo || "힌트 없이, 감으로"}
                  </span>
                  <span className="blind-cta">{armed === i ? "한 번 더 누르면 공개" : ""}</span>
                </span>
                <span className="blind-face" aria-hidden={!open}>
                  <Tile
                    index={indexOf(p)}
                    kind={kind}
                    name={p.name}
                    image={p.image_url}
                    showIndex={false}
                  />
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <p className="hint">
        {opened === null ? "이름도 사진도 없이, 힌트만 보고 골라 줘" : "두근두근, 공개!"}
      </p>
    </div>
  );
}
