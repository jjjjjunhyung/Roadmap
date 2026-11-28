import { Link } from "@tanstack/react-router";
import { type CSSProperties, type Ref, useEffect, useRef, useState } from "react";

import type { Extra, Kind, Place, StepSummary, WeatherReport } from "../lib/api";
import { scramble, sfx, sound } from "../lib/feel";
import { KIND_LABEL, auraVars, formatDate, two } from "../lib/look";
import { Glyph } from "./Glyph";
import { HourWeather } from "./Weather";
import { useReactive } from "../lib/useReactive";

/**
 * Candidate artwork. `index` is the candidate's slot in its step (sets colours and number);
 * `image` lays a photo over the colours, which stay as the fallback while it loads or if it fails.
 */
export function Tile(props: {
  index: number;
  kind?: Kind;
  name?: string;
  image?: string;
  className?: string;
  style?: CSSProperties;
  showIndex?: boolean;
  ref?: Ref<HTMLDivElement>;
}) {
  const { index, kind, name, image, className = "", style, showIndex = true, ref } = props;
  const [failed, setFailed] = useState<string | null>(null);
  const photo = image && image !== failed ? image : "";
  return (
    <div
      ref={ref}
      className={`tile${photo ? " has-photo" : ""} ${className}`}
      style={{ ...auraVars(index), ...style }}
    >
      {photo && (
        <img
          className="photo"
          src={photo}
          alt=""
          decoding="async"
          draggable={false}
          referrerPolicy="no-referrer"
          onError={() => setFailed(photo)}
        />
      )}
      {showIndex && <span className="idx">{two(index)}</span>}
      {kind && <Glyph kind={kind} />}
      {name && <span className="nm">{name}</span>}
      <span className="glare" />
    </div>
  );
}

/** Opens the place in the map app. Taps on it never reach the card around it. */
export function MapChip({ href }: { href: string }) {
  const naver = /(^|\.)naver\.(me|com)$/.test(hostOf(href));
  return (
    <a
      className={`map-chip${naver ? " naver" : ""}`}
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 21.5s-6.5-6-6.5-11a6.5 6.5 0 0 1 13 0c0 5-6.5 11-6.5 11z" />
        <circle cx="12" cy="10.5" r="2.3" />
      </svg>
      {naver ? "네이버 지도" : "지도"}
    </a>
  );
}

const hostOf = (href: string) => {
  try {
    return new URL(href).hostname;
  } catch {
    return "";
  }
};

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

/** `home` turns "for you" into a way back to the archive of every date. */
export function Masthead(props: { date: string; title: string; lede?: string; home?: boolean }) {
  const { date, title, lede, home } = props;
  const d = formatDate(date);
  return (
    <header className="masthead">
      <div className="topline">
        {home ? (
          <Link className="for home" to="/">
            우리의 데이트
          </Link>
        ) : (
          <span className="for">for you</span>
        )}
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
export function Itinerary(props: {
  steps: StepSummary[];
  morph: string | null;
  /** the open step whose game is on screen */
  playing?: string | null;
}) {
  const { steps, morph, playing = null } = props;
  // five or more steps share a phone's width, so the strip tightens and the words get shorter
  const many = steps.length > 4;
  return (
    <ol
      className={`itin${many ? " many" : ""}`}
      style={many ? ({ "--n": steps.length } as CSSProperties) : undefined}
      aria-label="코스 진행 상황"
    >
      {steps.map((s) => (
        <li key={s.id} data-state={s.state} data-playing={s.id === playing || undefined}>
          <span className="t">{s.time || "—"}</span>
          <span className="label">{s.label}</span>
          <span className="v" style={s.id === morph ? { viewTransitionName: "picked" } : undefined}>
            {s.state !== "open"
              ? s.picked?.name
              : s.id === playing
                ? many
                  ? "지금"
                  : "고르는 중"
                : many
                  ? "고르기"
                  : "골라 줘"}
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
          <Tile ref={tileRef} index={index} kind={kind} image={place.image_url} className="r" />
          <div>
            <h3 id="res-name" ref={nameRef} />
            <p>{place.memo}</p>
          </div>
        </div>
        {place.map_url && (
          <div className="map">
            <MapChip href={place.map_url} />
          </div>
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
  weather,
  extras = [],
  onChange,
  onExtra,
}: {
  date: string;
  steps: StepSummary[];
  sealRef?: Ref<HTMLSpanElement>;
  /** the day's forecast: each stop shows its hour */
  weather?: WeatherReport;
  /** places they dropped by, shown after the stop each followed */
  extras?: Extra[];
  /** while fixing the day: each stop offers to record what really happened */
  onChange?: (s: StepSummary) => void;
  /** while fixing the day: edit a place they dropped by, or (null) add one */
  onExtra?: (e: Extra | null) => void;
}) {
  const extraRow = (e: Extra) => (
    <li key={e.id} className="extra">
      <span className="tm">
        {e.time || "—"}
        <HourWeather report={weather} time={e.time} />
      </span>
      <span className="what">
        <span className="label">
          {KIND_LABEL[e.kind] ?? "활동"}
          <i className="ad-lib">즉흥 추가</i>
        </span>
        <b>{e.name}</b>
        {e.memo && <span className="memo">{e.memo}</span>}
        {e.map_url && <MapChip href={e.map_url} />}
        {onExtra && (
          <button type="button" className="fix" onClick={() => onExtra(e)}>
            고치기
          </button>
        )}
      </span>
    </li>
  );
  const ids = new Set(steps.map((s) => s.id));
  // extras whose stop is gone (or that came last) close the day
  const tail = extras.filter((e) => !e.after_step_id || !ids.has(e.after_step_id));
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
        {steps
          .map((s) => {
            const a = s.actual;
            return (
              <li key={s.id} className={a ? "changed" : undefined}>
                <span className="tm">
                  {s.time || "—"}
                  <HourWeather report={weather} time={s.time} />
                </span>
                <span className="what">
                  <span className="label">
                    {s.label}
                    {a && <i className="ad-lib">{a.skipped ? "안 갔어" : "즉흥 변경"}</i>}
                  </span>
                  {a ? (
                    <>
                      {/* the plan stays, crossed out */}
                      <s className="was">{s.picked?.name}</s>
                      {!a.skipped && (
                        <b className="instead">
                          <i>대신</i>
                          {a.name}
                        </b>
                      )}
                      {a.memo && <span className="memo">{a.memo}</span>}
                      {!a.skipped && a.map_url && <MapChip href={a.map_url} />}
                    </>
                  ) : (
                    <>
                      <b>{s.picked?.name}</b>
                      {s.picked?.memo && <span className="memo">{s.picked.memo}</span>}
                      {s.picked?.map_url && <MapChip href={s.picked.map_url} />}
                    </>
                  )}
                  {onChange && s.picked && (
                    <button type="button" className="fix" onClick={() => onChange(s)}>
                      {a ? "다시 고치기" : "여기 바뀌었어?"}
                    </button>
                  )}
                </span>
              </li>
            );
          })
          .flatMap((row, i) => [
            row,
            ...extras.filter((e) => e.after_step_id === steps[i].id).map(extraRow),
          ])}
        {tail.map(extraRow)}
        {onExtra && (
          <li className="add-extra">
            <button type="button" className="btn small ghost" onClick={() => onExtra(null)}>
              + 즉흥으로 들른 곳 추가
            </button>
          </li>
        )}
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
