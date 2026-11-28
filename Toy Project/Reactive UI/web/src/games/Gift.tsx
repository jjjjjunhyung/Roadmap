import { type CSSProperties, useRef, useState } from "react";

import { Tile } from "../components/ui";
import { haptic, sfx, shuffle } from "../lib/feel";
import { useLater } from "./kit";
import type { GameProps } from "./types";

/** Wrapping paper by position, never by place: the boxes give nothing away. */
const PAPER = [
  ["#9b1c34", "#f4d3c6"],
  ["#1f4f45", "#f1e3b5"],
  ["#23365e", "#e9c46a"],
  ["#5b2a52", "#f2d7e8"],
  ["#7a4b1f", "#f6e7c8"],
  ["#2f5d7c", "#fbe3e8"],
  ["#4c5b2a", "#f3e2a9"],
  ["#6b2737", "#dfe7f2"],
];

/** Gift boxes, one for each place: shake one open; the others open after it. */
export function Gift({ candidates, kind, indexOf, onPicked }: GameProps) {
  const [deal] = useState(() => shuffle(candidates));
  const [chosen, setChosen] = useState<number | null>(null);
  const [stage, setStage] = useState<"" | "shake" | "open" | "all">("");
  const els = useRef<(HTMLButtonElement | null)[]>([]);
  const later = useLater();

  const choose = (i: number) => {
    if (chosen !== null) return;
    setChosen(i);
    setStage("shake");
    sfx.whoosh();
    haptic([12, 40, 12, 40, 12]);
    later(() => {
      setStage("open");
      sfx.pop();
      haptic(20);
    }, 900);
    later(() => setStage("all"), 1600);
    later(() => onPicked(deal[i], els.current[i]), 2200);
  };

  return (
    <div className="center">
      <ul className="gifts">
        {deal.map((p, i) => {
          const me = chosen === i;
          const cls = me ? ` me ${stage}` : stage === "all" ? " open dim" : "";
          const [paper, ribbon] = PAPER[i % PAPER.length];
          return (
            <li key={p.id}>
              <button
                ref={(el) => {
                  els.current[i] = el;
                }}
                className={`gift${cls}`}
                style={{ "--wrap": paper, "--ribbon": ribbon } as CSSProperties}
                disabled={chosen !== null}
                aria-label={`${i + 1}번 선물 열기`}
                onPointerEnter={() => chosen === null && sfx.tick()}
                onClick={() => choose(i)}
              >
                <span className="gift-in">
                  <Tile
                    index={indexOf(p)}
                    kind={kind}
                    name={p.name}
                    image={p.image_url}
                    showIndex={false}
                  />
                </span>
                <span className="gift-body" aria-hidden="true" />
                <span className="gift-lid" aria-hidden="true">
                  <i className="bow" />
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <p className="hint">{chosen === null ? "마음이 가는 선물 하나" : "열어 보자!"}</p>
    </div>
  );
}
