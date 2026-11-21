import { type CSSProperties, useEffect, useRef, useState } from "react";

import { MapChip, Tile } from "../components/ui";
import type { Kind, Place } from "../lib/api";
import { burst, haptic, reducedMotion, sfx, shuffle } from "../lib/feel";
import { aura } from "../lib/look";
import { useReactive } from "../lib/useReactive";
import type { GameProps } from "./types";

interface Bracket {
  round: Place[];
  next: Place[];
  i: number;
  roundNo: number;
  winner?: Place;
}

/** Applies byes and round changes until a playable pair (or a winner) remains. */
function settle(s: Bracket): Bracket {
  let { round, next, i, roundNo } = s;
  for (;;) {
    if (i >= round.length) {
      if (next.length === 1) return { round, next, i, roundNo, winner: next[0] };
      round = next;
      next = [];
      i = 0;
      roundNo++;
      continue;
    }
    if (i === round.length - 1) {
      next = [...next, round[i]];
      i++;
      continue;
    }
    return { round, next, i, roundNo };
  }
}

/** Head-to-head bracket. The card you lean toward leans back; its rival flinches. */
export function WorldCup({ candidates, kind, indexOf, onPicked }: GameProps) {
  const [b, setB] = useState<Bracket>(() =>
    settle({ round: shuffle(candidates), next: [], i: 0, roundNo: 0 }),
  );
  const [hover, setHover] = useState<number | null>(null);
  const [choice, setChoice] = useState<number | null>(null);
  const cardEls = useRef<(HTMLButtonElement | null)[]>([]);
  const timer = useRef(0);
  useEffect(() => () => clearTimeout(timer.current), []);

  const pair = [b.round[b.i], b.round[b.i + 1]];
  const matches = Math.floor(b.round.length / 2);
  const m = b.i / 2 + 1;
  const bracket = 2 ** Math.ceil(Math.log2(b.round.length));

  const choose = (k: number) => {
    if (choice !== null) return;
    setChoice(k);
    sfx.pop();
    haptic(14);
    burst(cardEls.current[k], [...aura(indexOf(pair[k]))], 14, 0.6);
    const after = settle({ ...b, next: [...b.next, pair[k]], i: b.i + 2 });
    timer.current = window.setTimeout(
      () => {
        if (after.winner) {
          onPicked(after.winner, cardEls.current[k]);
          return;
        }
        setB(after);
        setChoice(null);
        setHover(null);
      },
      reducedMotion() ? 40 : 640,
    );
  };

  return (
    <div className="wc">
      <div className="wc-top">
        <span className="wc-round">
          {bracket <= 2 ? "결승" : `${bracket}강`}
          <span className="it">
            {m}/{matches}
          </span>
        </span>
        <span className="ticks" aria-hidden="true">
          {Array.from({ length: matches }, (_, j) => (
            <i key={j} className={j < m ? "on" : ""} />
          ))}
        </span>
      </div>
      <div className="pair" key={`${b.roundNo}-${b.i}`}>
        {pair.map((p, k) => (
          <Contender
            key={p.id}
            place={p}
            index={indexOf(p)}
            kind={kind}
            side={k}
            state={
              choice === null
                ? hover !== null && hover !== k
                  ? "flinch"
                  : "enter"
                : choice === k
                  ? "win"
                  : "lose"
            }
            disabled={choice !== null}
            refCb={(el) => {
              cardEls.current[k] = el;
            }}
            onEnter={() => setHover(k)}
            onLeave={() => setHover(null)}
            onChoose={() => choose(k)}
          />
        ))}
        <span className="vs" aria-hidden="true">
          vs
        </span>
      </div>
      <p className="hint">더 가고 싶은 쪽을 눌러 줘</p>
    </div>
  );
}

function Contender(props: {
  place: Place;
  index: number;
  kind: Kind;
  side: number;
  state: "enter" | "flinch" | "win" | "lose";
  disabled: boolean;
  refCb: (el: HTMLButtonElement | null) => void;
  onEnter: () => void;
  onLeave: () => void;
  onChoose: () => void;
}) {
  const { place, index, kind, side, state, disabled, refCb, onEnter, onLeave, onChoose } = props;
  const lean = useRef<HTMLDivElement>(null);
  useReactive(lean);
  const style = {
    "--away": side ? "10px" : "-10px",
    "--spin": side ? "14deg" : "-14deg",
  } as CSSProperties;
  return (
    <div
      className={`contender ${state}`}
      style={style}
      onPointerEnter={onEnter}
      onPointerLeave={onLeave}
    >
      <button
        ref={refCb}
        className="pick"
        disabled={disabled}
        aria-label={`${place.name} 고르기`}
        onClick={onChoose}
      >
        <div className="r" ref={lean}>
          <Tile index={index} kind={kind} name={place.name} image={place.image_url} />
        </div>
        {place.memo && <span className="memo">{place.memo}</span>}
      </button>
      {place.map_url && <MapChip href={place.map_url} />}
    </div>
  );
}
