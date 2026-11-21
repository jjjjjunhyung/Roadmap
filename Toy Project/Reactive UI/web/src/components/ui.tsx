import { type CSSProperties, type Ref, useEffect, useRef, useState } from "react";

import type { Kind, Place, StepSummary } from "../lib/api";
import { scramble, sfx, sound } from "../lib/feel";
import { auraVars, formatDate, two } from "../lib/look";
import { Glyph } from "./Glyph";
import { useReactive } from "../lib/useReactive";

/** Candidate artwork. `index` is the candidate's slot in its step (sets colours and number). */
export function Tile(props: {
  index: number;
  kind?: Kind;
  name?: string;
  className?: string;
  style?: CSSProperties;
  showIndex?: boolean;
  ref?: Ref<HTMLDivElement>;
}) {
  const { index, kind, name, className = "", style, showIndex = true, ref } = props;
  return (
    <div ref={ref} className={`tile ${className}`} style={{ ...auraVars(index), ...style }}>
      {showIndex && <span className="idx">{two(index)}</span>}
      {kind && <Glyph kind={kind} />}
      {name && <span className="nm">{name}</span>}
      <span className="glare" />
    </div>
  );
}

export function SoundToggle() {
  const [on, setOn] = useState(sound.on);
  return (
    <button
      className="snd"
      aria-pressed={on}
      aria-label={on ? "소리 끄기" : "소리 켜기"}
      onClick={() => {
        sound.on = !on;
        setOn(!on);
        if (!on) sfx.tap();
      }}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.4}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M4.5 9.5v5h3.5l4.5 4v-13l-4.5 4H4.5z" />
        <path className="wave" d="M15.5 9.5a3.5 3.5 0 0 1 0 5M18 7a7 7 0 0 1 0 10" />
      </svg>
    </button>
  );
}

export function Masthead({ date, title, lede }: { date: string; title: string; lede?: string }) {
  const d = formatDate(date);
  return (
    <header className="masthead">
      <div className="topline">
        <span className="for">for you</span>
        <SoundToggle />
      </div>
      <p className="date" aria-label={d.full}>
        {d.md}
        <small>{d.dow}</small>
      </p>
      <h1>{title}</h1>
      {lede && <p className="lede">{lede}</p>}
    </header>
  );
}

/** Course strip; the step named in `morph` takes part in the shared-element transition. */
export function Itinerary({ steps, morph }: { steps: StepSummary[]; morph: string | null }) {
  return (
    <ol className="itin" aria-label="코스 진행 상황">
      {steps.map((s) => (
        <li key={s.id} data-state={s.state}>
          <span className="t">{s.time || "—"}</span>
          <span className="label">{s.label}</span>
          <span className="v" style={s.id === morph ? { viewTransitionName: "picked" } : undefined}>
            {s.state === "done"
              ? s.picked?.name
              : s.state === "current"
                ? "고르는 중"
                : "아직 비밀"}
          </span>
        </li>
      ))}
    </ol>
  );
}

export function ResultSheet(props: {
  place: Place;
  index: number;
  kind: Kind;
  heading: string;
  rerollsLeft: number | null;
  onRetry: () => void;
  onConfirm: () => void;
}) {
  const { place, index, kind, heading, rerollsLeft, onRetry, onConfirm } = props;
  const nameRef = useRef<HTMLHeadingElement>(null);
  const tileRef = useRef<HTMLDivElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  useReactive(tileRef, { tilt: 18, magnet: 3 });
  useEffect(() => {
    if (nameRef.current) scramble(nameRef.current, place.name);
    confirmRef.current?.focus({ preventScroll: true });
  }, [place.name]);
  return (
    <div className="scrim" role="dialog" aria-modal="true" aria-labelledby="res-name">
      <div className="sheet">
        <span className="label">{heading}</span>
        <div className="row" id="morph-src">
          <Tile ref={tileRef} index={index} kind={kind} className="r" />
          <div>
            <h3 id="res-name" ref={nameRef} />
            <p>{place.memo}</p>
          </div>
        </div>
        {place.map_url && (
          <a className="map" href={place.map_url} target="_blank" rel="noopener noreferrer">
            지도에서 보기
          </a>
        )}
        <div className="actions">
          {rerollsLeft !== null && rerollsLeft > 0 && (
            <button className="btn" onClick={onRetry}>
              다시 하기 · {rerollsLeft}번
            </button>
          )}
          <button ref={confirmRef} className="btn accent" onClick={onConfirm}>
            이걸로 할래
          </button>
        </div>
      </div>
    </div>
  );
}

export function Ticket({
  date,
  steps,
  sealRef,
}: {
  date: string;
  steps: StepSummary[];
  sealRef?: Ref<HTMLSpanElement>;
}) {
  const d = formatDate(date);
  return (
    <article className="ticket" aria-label="완성된 데이트 코스">
      <div className="head">
        <span className="label">Course ticket</span>
        <p className="date" aria-label={d.full}>
          {d.md}
          <small>{d.dow}</small>
        </p>
        <h2>오늘의 코스가 완성됐어</h2>
        <span className="seal" ref={sealRef}>
          {d.md.slice(3)}
        </span>
      </div>
      <div className="tear" aria-hidden="true" />
      <ol>
        {steps.map((s) => (
          <li key={s.id}>
            <span className="tm">{s.time || "—"}</span>
            <span className="what">
              <span className="label">{s.label}</span>
              <b>{s.picked?.name}</b>
              {s.picked?.memo && <span className="memo">{s.picked.memo}</span>}
              {s.picked?.map_url && (
                <a href={s.picked.map_url} target="_blank" rel="noopener noreferrer">
                  지도
                </a>
              )}
            </span>
          </li>
        ))}
      </ol>
      <div className="tear" aria-hidden="true" />
      <div className="foot">
        <div className="meta label">
          <span>Admit two</span>
          <span>No. {d.md.replace(".", "")}</span>
        </div>
      </div>
    </article>
  );
}

export function Toast({ message, onDone }: { message: string | null; onDone: () => void }) {
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(onDone, 3600);
    return () => clearTimeout(t);
  }, [message, onDone]);
  return message ? (
    <div className="toast" role="status">
      {message}
    </div>
  ) : null;
}
