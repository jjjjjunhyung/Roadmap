import {
  type CSSProperties,
  type PointerEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useRef,
  useState,
} from "react";

import { Tile } from "../components/ui";
import type { Place } from "../lib/api";
import { burst, haptic, reducedMotion, sfx, shuffle } from "../lib/feel";
import { aura } from "../lib/look";
import { useReactive } from "../lib/useReactive";
import type { GameProps } from "./types";

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

const HEART = "M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.5-7 10-7 10z";
const CROSS = "M7 7l10 10M17 7L7 17";

/**
 * A deck you thumb through. The card follows your finger with a little rotation and the next
 * one rises as you drag; flick right to keep, left to pass. Then choose among the keepers.
 */
export function Swipe({ candidates, kind, indexOf, onPicked }: GameProps) {
  const [deck, setDeck] = useState(() => shuffle(candidates));
  const [idx, setIdx] = useState(0);
  const [liked, setLiked] = useState<Place[]>([]);
  const deckRef = useRef<HTMLDivElement>(null);
  const yesRef = useRef<HTMLButtonElement>(null);
  const flying = useRef(false);
  const timer = useRef(0);
  const drag = useRef({ on: false, sx: 0, sy: 0, dx: 0, lastX: 0, lastT: 0, vx: 0 });
  useEffect(() => () => clearTimeout(timer.current), []);

  const card = (d: number) => deckRef.current?.querySelector<HTMLElement>(`[data-d="${d}"]`);

  const fly = (dir: number) => {
    const top = card(0);
    if (!top || flying.current) return;
    flying.current = true;
    const place = deck[idx];
    top.style.transition = "transform .45s cubic-bezier(.3,.4,.6,1), opacity .45s";
    top.style.setProperty("--dx", `${dir * 460}px`);
    top.style.setProperty("--dy", "-40px");
    top.style.setProperty("--rot", `${dir * 30}deg`);
    top.style.opacity = "0";
    card(1)?.style.setProperty("--rise", "1");
    const keep = dir > 0 ? [...liked, place] : liked;
    if (dir > 0) {
      sfx.pop();
      haptic(12);
      burst(yesRef.current, [...aura(indexOf(place))], 10, 0.5);
    } else {
      sfx.whoosh();
      haptic(6);
    }
    timer.current = window.setTimeout(
      () => {
        flying.current = false;
        if (idx + 1 >= deck.length && keep.length === 1) onPicked(keep[0], deckRef.current);
        setLiked(keep);
        setIdx(idx + 1);
      },
      reducedMotion() ? 20 : 300,
    );
  };

  const down = (e: PointerEvent<HTMLDivElement>) => {
    if (flying.current) return;
    const g = drag.current;
    Object.assign(g, { on: true, sx: e.clientX, sy: e.clientY, dx: 0, vx: 0 });
    g.lastX = e.clientX;
    g.lastT = e.timeStamp;
    e.currentTarget.setPointerCapture(e.pointerId);
    e.currentTarget.style.transition = "none";
    const second = card(1);
    if (second) second.style.transition = "none";
    sfx.tick();
  };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const g = drag.current;
    if (!g.on) return;
    g.dx = e.clientX - g.sx;
    g.vx = (e.clientX - g.lastX) / Math.max(1, e.timeStamp - g.lastT);
    g.lastX = e.clientX;
    g.lastT = e.timeStamp;
    const el = e.currentTarget;
    el.style.setProperty("--dx", `${g.dx}px`);
    el.style.setProperty("--dy", `${(e.clientY - g.sy) * 0.3}px`);
    el.style.setProperty("--rot", `${g.dx / 13}deg`);
    el.style.setProperty("--yes", String(clamp(g.dx / 80, 0, 1)));
    el.style.setProperty("--no", String(clamp(-g.dx / 80, 0, 1)));
    card(1)?.style.setProperty("--rise", String(clamp(Math.abs(g.dx) / 140, 0, 1)));
  };
  const up = (e: PointerEvent<HTMLDivElement>) => {
    const g = drag.current;
    if (!g.on) return;
    g.on = false;
    if (e.timeStamp - g.lastT > 100) g.vx = 0; // held still before letting go: no flick
    const el = e.currentTarget;
    el.style.transition = "";
    const second = card(1);
    if (second) second.style.transition = "";
    if (Math.abs(g.dx) > 100 || Math.abs(g.vx) > 0.7) {
      fly(Math.sign(g.dx || g.vx));
      return;
    }
    for (const v of ["--dx", "--dy", "--rot", "--yes", "--no"]) el.style.removeProperty(v);
    second?.style.removeProperty("--rise");
  };

  if (idx >= deck.length) {
    if (!liked.length) {
      return (
        <div className="center sw-empty">
          <p className="hint">전부 넘겼어. 다시 볼까?</p>
          <button
            className="btn ink"
            onClick={() => {
              sfx.tap();
              setDeck(shuffle(candidates));
              setIdx(0);
            }}
          >
            다시 보기
          </button>
        </div>
      );
    }
    return (
      <div className="choose-list">
        <p className="hint">
          {liked.length > 1 ? `좋아한 ${liked.length}곳 중에서 하나만` : "좋아한 곳은 여기 하나"}
        </p>
        {liked.map((p) => (
          <ChooseRow
            key={p.id}
            place={p}
            index={indexOf(p)}
            onChoose={(el) => {
              sfx.pop();
              haptic(14);
              onPicked(p, el);
            }}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="center">
      <div className="deck" ref={deckRef}>
        {deck.slice(idx, idx + 3).map((p, d) => (
          <div
            key={p.id}
            className="sw"
            data-d={d}
            style={{ "--d": d, zIndex: 10 - d } as CSSProperties}
            aria-hidden={d > 0}
            onPointerDown={d === 0 ? down : undefined}
            onPointerMove={d === 0 ? move : undefined}
            onPointerUp={d === 0 ? up : undefined}
            onPointerCancel={d === 0 ? up : undefined}
          >
            <Tile index={indexOf(p)} kind={kind} name={p.name} image={p.image_url} />
            {p.memo && <span className="memo">{p.memo}</span>}
            <span className="stamp yes">Yes</span>
            <span className="stamp no">Pass</span>
          </div>
        ))}
      </div>
      <div className="sw-actions">
        <Orb label="패스" onClick={() => fly(-1)}>
          <path d={CROSS} strokeLinecap="round" />
        </Orb>
        <Orb label="좋아" btnRef={yesRef} onClick={() => fly(1)}>
          <path d={HEART} />
        </Orb>
      </div>
      <p className="hint">
        좌우로 넘기거나 버튼을 눌러 줘{" "}
        <span className="it">
          — {idx + 1} / {deck.length}
        </span>
      </p>
    </div>
  );
}

function Orb(props: {
  label: string;
  onClick: () => void;
  btnRef?: RefObject<HTMLButtonElement | null>;
  children: ReactNode;
}) {
  const own = useRef<HTMLButtonElement>(null);
  const ref = props.btnRef ?? own;
  useReactive(ref, { tilt: 0, magnet: 10 });
  return (
    <button ref={ref} className="orb r" aria-label={props.label} onClick={props.onClick}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.4}>
        {props.children}
      </svg>
      <span className="glare" />
    </button>
  );
}

function ChooseRow(props: { place: Place; index: number; onChoose: (el: Element) => void }) {
  const { place, index, onChoose } = props;
  const ref = useRef<HTMLButtonElement>(null);
  useReactive(ref, { tilt: 5, magnet: 4 });
  return (
    <button ref={ref} className="choose r" onClick={(e) => onChoose(e.currentTarget)}>
      <Tile index={index} showIndex={false} image={place.image_url} />
      <span>
        <b>{place.name}</b>
        {place.memo && <small>{place.memo}</small>}
      </span>
      <span className="glare" />
    </button>
  );
}
