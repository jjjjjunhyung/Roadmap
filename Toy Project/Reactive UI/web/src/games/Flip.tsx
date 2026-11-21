import { type CSSProperties, useEffect, useRef, useState } from "react";

import { Glyph } from "../components/Glyph";
import { Tile } from "../components/ui";
import type { Kind, Place } from "../lib/api";
import { haptic, reducedMotion, sfx, shuffle } from "../lib/feel";
import { useReactive } from "../lib/useReactive";
import type { GameProps } from "./types";

/** A fanned hand of face-down cards. Cards lift as you hover; the one you tap turns over, then the rest. */
export function Flip({ candidates, kind, indexOf, onPicked }: GameProps) {
  const [deal] = useState(() => shuffle(candidates));
  const [chosen, setChosen] = useState<number | null>(null);
  const [revealed, setRevealed] = useState(false);
  const els = useRef<(HTMLButtonElement | null)[]>([]);
  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  const later = (f: () => void, ms: number) =>
    timers.current.push(window.setTimeout(f, reducedMotion() ? 20 : ms));

  const n = deal.length;
  // wider spread for bigger hands so every card keeps a strip you can tap
  const spread = n <= 5 ? 44 : 44 + (n - 5) * 6;

  const choose = (i: number) => {
    if (chosen !== null) return;
    setChosen(i);
    sfx.whoosh();
    haptic(18);
    later(() => {
      setRevealed(true);
      deal.forEach((_, j) => j !== i && later(sfx.tick, j * 90));
      later(() => onPicked(deal[i], els.current[i]), Math.max(680, n * 90 + 200));
    }, 950);
  };

  return (
    <div className="center">
      <div className="fan">
        {deal.map((p, i) => (
          <FanCard
            key={p.id}
            place={p}
            index={indexOf(p)}
            kind={kind}
            no={i}
            angle={(i - (n - 1) / 2) * (spread / Math.max(1, n - 1))}
            delay={revealed && i !== chosen ? i * 90 : 0}
            state={
              chosen === null ? "" : i === chosen ? "lift open" : revealed ? "dim open" : "dim"
            }
            disabled={chosen !== null}
            refCb={(el) => {
              els.current[i] = el;
            }}
            onChoose={() => choose(i)}
          />
        ))}
      </div>
      <p className="hint">마음이 가는 카드 한 장</p>
    </div>
  );
}

function FanCard(props: {
  place: Place;
  index: number;
  kind: Kind;
  no: number;
  angle: number;
  delay: number;
  state: string;
  disabled: boolean;
  refCb: (el: HTMLButtonElement | null) => void;
  onChoose: () => void;
}) {
  const { place, index, kind, no, angle, delay, state, disabled, refCb, onChoose } = props;
  const back = useRef<HTMLSpanElement>(null);
  useReactive(back, { tilt: 16, magnet: 0 });
  const style = { "--a": `${angle}deg`, "--delay": `${delay}ms` } as CSSProperties;
  return (
    <button
      ref={refCb}
      className={`fcard ${state}`}
      style={style}
      disabled={disabled}
      aria-label={`${no + 1}번째 카드 뒤집기`}
      onPointerEnter={() => !disabled && sfx.tick()}
      onClick={onChoose}
    >
      <span className="inner">
        <span className="face back r" ref={back}>
          <Glyph kind={kind} />
          <span className="glare" />
        </span>
        <span className="face front" aria-hidden={!state.includes("open")}>
          <Tile index={index} name={place.name} showIndex={false} image={place.image_url} />
        </span>
      </span>
    </button>
  );
}
