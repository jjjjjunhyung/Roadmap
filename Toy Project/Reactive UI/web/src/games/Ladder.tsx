import { type CSSProperties, useEffect, useRef, useState } from "react";

import { Tile } from "../components/ui";
import { haptic, reducedMotion, sfx, shuffle } from "../lib/feel";
import { useReactive } from "../lib/useReactive";
import type { GameProps } from "./types";

const W = 320; // svg viewBox width
const H = 300; // svg viewBox height
const ROWS = 10; // rung levels

/** Random rungs, never two side by side; every gap gets at least one so no lane is a straight drop. */
function rungs(n: number) {
  const rung = Array.from({ length: ROWS }, () => Array<boolean>(Math.max(0, n - 1)).fill(false));
  const free = (r: number, c: number) =>
    !(c > 0 && rung[r][c - 1]) && !(c < n - 2 && rung[r][c + 1]);
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < n - 1; c++) if (Math.random() < 0.45 && free(r, c)) rung[r][c] = true;
  for (let c = 0; c < n - 1; c++) {
    if (rung.some((row) => row[c])) continue;
    const r = shuffle([...rung.keys()]).find((r) => free(r, c));
    if (r !== undefined) rung[r][c] = true;
  }
  return rung;
}

/** Pick a start; a glowing comet runs the ladder and turns over the card it lands on. */
export function Ladder({ candidates, indexOf, onPicked }: GameProps) {
  const n = candidates.length;
  const [{ rung, ends }] = useState(() => ({ rung: rungs(n), ends: shuffle(candidates) }));
  const [start, setStart] = useState<number | null>(null);
  const [landed, setLanded] = useState<number | null>(null);
  const trailRef = useRef<SVGPolylineElement>(null);
  const cometRef = useRef<SVGCircleElement>(null);
  const haloRef = useRef<SVGCircleElement>(null);
  const endEls = useRef<(HTMLDivElement | null)[]>([]);
  const raf = useRef(0);
  const timer = useRef(0);
  useEffect(
    () => () => {
      cancelAnimationFrame(raf.current);
      clearTimeout(timer.current);
    },
    [],
  );

  const x = (c: number) => ((c + 0.5) * W) / n;
  const y = (r: number) => 16 + (r + 1) * ((H - 32) / (ROWS + 1));

  const go = (from: number) => {
    const trail = trailRef.current;
    const comet = cometRef.current;
    const halo = haloRef.current;
    if (start !== null || !trail || !comet || !halo) return;
    setStart(from);
    sfx.pop();
    haptic(12);
    let c = from;
    const pts: [number, number][] = [[x(c), 0]];
    for (let r = 0; r < ROWS; r++) {
      if (c < n - 1 && rung[r][c]) {
        pts.push([x(c), y(r)], [x(c + 1), y(r)]);
        c++;
      } else if (c > 0 && rung[r][c - 1]) {
        pts.push([x(c), y(r)], [x(c - 1), y(r)]);
        c--;
      }
    }
    pts.push([x(c), H]);
    const end = c;
    trail.setAttribute("points", pts.map((p) => p.join(",")).join(" "));
    const len = trail.getTotalLength();
    trail.style.strokeDasharray = `${len}`;
    trail.style.strokeDashoffset = `${len}`;
    comet.setAttribute("opacity", "1");
    halo.setAttribute("opacity", "0.16");
    const speed = reducedMotion() ? 1e6 : 190;
    let dist = 0;
    let t0 = performance.now();
    let lastDir = "v";
    const step = (now: number) => {
      dist = Math.min(len, dist + speed * Math.min(0.05, (now - t0) / 1000));
      t0 = now;
      const pt = trail.getPointAtLength(dist);
      const ahead = trail.getPointAtLength(Math.min(len, dist + 1));
      const dir = Math.abs(ahead.x - pt.x) > Math.abs(ahead.y - pt.y) ? "h" : "v";
      if (dir !== lastDir) {
        lastDir = dir;
        sfx.tick();
        haptic(3);
      }
      for (const el of [comet, halo]) {
        el.setAttribute("cx", String(pt.x));
        el.setAttribute("cy", String(pt.y));
      }
      trail.style.strokeDashoffset = `${len - dist}`;
      if (dist < len) {
        raf.current = requestAnimationFrame(step);
        return;
      }
      setLanded(end);
      sfx.pop();
      timer.current = window.setTimeout(
        () => onPicked(ends[end], endEls.current[end]),
        reducedMotion() ? 20 : 780,
      );
    };
    raf.current = requestAnimationFrame(step);
  };

  const grid = { gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` } as CSSProperties;
  return (
    <div className={`ladder${n > 5 ? " dense" : ""}`}>
      <div className="lane" style={grid}>
        {candidates.map((p, c) => (
          <StartButton
            key={p.id}
            no={c}
            chosen={start === c}
            disabled={start !== null}
            onGo={() => go(c)}
          />
        ))}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="사다리">
        <g className="rails" strokeWidth={2} strokeLinecap="round">
          {candidates.map((p, c) => (
            <line key={p.id} x1={x(c)} y1={0} x2={x(c)} y2={H} />
          ))}
          {rung.map((row, r) =>
            row.map((on, c) =>
              on ? <line key={`${r}-${c}`} x1={x(c)} y1={y(r)} x2={x(c + 1)} y2={y(r)} /> : null,
            ),
          )}
        </g>
        <polyline
          ref={trailRef}
          className="trail"
          fill="none"
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          points=""
        />
        <circle ref={haloRef} className="comet" r={14} opacity={0} />
        <circle ref={cometRef} className="comet" r={5.5} opacity={0} />
      </svg>
      <div className="lane" style={grid}>
        {ends.map((p, c) => (
          <div
            key={p.id}
            className={`end${landed === c ? " open" : ""}`}
            ref={(el) => {
              endEls.current[c] = el;
            }}
          >
            <div className="in">
              <div className="f f1">?</div>
              <div className="f f2" aria-hidden={landed !== c}>
                <Tile index={indexOf(p)} showIndex={false} image={p.image_url} />
                <span className="t">{p.name}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
      <p className="hint">출발 번호를 골라 줘 · 도착한 카드가 결과야</p>
    </div>
  );
}

function StartButton(props: { no: number; chosen: boolean; disabled: boolean; onGo: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  useReactive(ref, { tilt: 0, magnet: 8 });
  return (
    <button
      ref={ref}
      className={`start r${props.chosen ? " chosen" : ""}`}
      disabled={props.disabled}
      aria-label={`${props.no + 1}번에서 출발`}
      onClick={props.onGo}
    >
      {props.no + 1}
      <span className="glare" />
    </button>
  );
}
