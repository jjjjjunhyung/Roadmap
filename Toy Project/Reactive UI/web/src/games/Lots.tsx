import { type CSSProperties, useRef, useState } from "react";

import { Tile } from "../components/ui";
import { haptic, sfx, shuffle } from "../lib/feel";
import { useLater } from "./kit";
import type { GameProps } from "./types";

const SLIPS = [
  "#f6e7c8",
  "#f4d3c6",
  "#dfe7f2",
  "#e3efd9",
  "#f2d7e8",
  "#fbe9b7",
  "#e6e0f5",
  "#d9f0ee",
];

/** Folded slips in a jar: draw one, it rises out and unfolds. */
export function Lots({ candidates, kind, indexOf, onPicked }: GameProps) {
  // each slip lies somewhere in the jar, at its own angle
  const [deal] = useState(() =>
    shuffle(candidates).map((p, i, all) => ({
      p,
      x: 14 + ((i * 61) % 72) + Math.random() * 6,
      y: 30 + Math.floor((i / all.length) * 3) * 18 + Math.random() * 10,
      r: Math.round(Math.random() * 70 - 35),
    })),
  );
  const [chosen, setChosen] = useState<number | null>(null);
  const [open, setOpen] = useState(false);
  const els = useRef<(HTMLButtonElement | null)[]>([]);
  const later = useLater();

  const draw = (i: number) => {
    if (chosen !== null) return;
    setChosen(i);
    sfx.whoosh();
    haptic(14);
    later(() => {
      setOpen(true);
      sfx.pop();
    }, 850);
    later(() => onPicked(deal[i].p, els.current[i]), 1700);
  };

  return (
    <div className="center">
      <div className={`jar${chosen !== null ? " drawn" : ""}`}>
        <span className="jar-lid" aria-hidden="true" />
        {deal.map((s, i) => (
          <button
            key={s.p.id}
            ref={(el) => {
              els.current[i] = el;
            }}
            className={`slip${chosen === i ? " up" : ""}${chosen === i && open ? " open" : ""}`}
            style={
              {
                left: `${s.x}%`,
                top: `${s.y}%`,
                "--r": `${s.r}deg`,
                "--slip": SLIPS[i % SLIPS.length],
              } as CSSProperties
            }
            disabled={chosen !== null}
            aria-label={`${i + 1}번 쪽지 뽑기`}
            onPointerEnter={() => chosen === null && sfx.tick()}
            onClick={() => draw(i)}
          >
            <span className="slip-fold" aria-hidden="true" />
            <span className="slip-open">
              <Tile index={indexOf(s.p)} kind={kind} image={s.p.image_url} showIndex={false} />
              <b>{s.p.name}</b>
            </span>
          </button>
        ))}
      </div>
      <p className="hint">{chosen === null ? "쪽지 하나를 뽑아 줘" : "펼쳐 보자"}</p>
    </div>
  );
}
