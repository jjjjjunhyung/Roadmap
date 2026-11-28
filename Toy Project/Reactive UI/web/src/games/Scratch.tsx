import { useEffect, useRef, useState } from "react";

import { Tile } from "../components/ui";
import { haptic, reducedMotion, sfx } from "../lib/feel";
import { pickOne, useLater, useLatest } from "./kit";
import type { GameProps } from "./types";

/** A scratch card: rub the silver off with a finger; once half of it is gone, it comes off. */
export function Scratch({ candidates, kind, indexOf, onPicked }: GameProps) {
  const [win] = useState(() => pickOne(candidates));
  const [cleared, setCleared] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const later = useLater();
  const picked = useLatest(onPicked);

  useEffect(() => {
    const cv = canvas.current;
    const ctx = cv?.getContext("2d", { willReadFrequently: true });
    const box = card.current;
    if (!cv || !ctx || !box) return;
    const dpr = Math.min(2, devicePixelRatio || 1);
    const { width: w, height: h } = box.getBoundingClientRect();
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
    ctx.scale(dpr, dpr);
    // the foil: brushed silver with a pattern of small hearts and a line of text
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, "#c9ccd3");
    g.addColorStop(0.45, "#eef0f3");
    g.addColorStop(0.55, "#b9bdc6");
    g.addColorStop(1, "#d9dce2");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "rgba(90,96,110,.18)";
    for (let y = 14; y < h; y += 26) {
      for (let x = (y / 26) % 2 ? 10 : 24; x < w; x += 28) {
        ctx.beginPath();
        ctx.arc(x, y, 2.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.fillStyle = "rgba(40,44,54,.62)";
    ctx.font = `600 17px ${cssFont(box)}`;
    ctx.textAlign = "center";
    ctx.fillText("여기를 긁어 줘", w / 2, h / 2 + 6);

    let down = false;
    let last: { x: number; y: number } | null = null;
    let strokes = 0;
    let done = false;
    const at = (e: PointerEvent) => {
      const r = cv.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const rub = (p: { x: number; y: number }) => {
      ctx.globalCompositeOperation = "destination-out";
      ctx.lineCap = "round";
      ctx.lineWidth = 38;
      ctx.beginPath();
      ctx.moveTo((last ?? p).x, (last ?? p).y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      last = p;
      if (++strokes % 6 === 0) {
        sfx.tick();
        check();
      }
    };
    const check = () => {
      const { data } = ctx.getImageData(0, 0, cv.width, cv.height);
      let clear = 0;
      let all = 0;
      for (let i = 3; i < data.length; i += 4 * 37) {
        all++;
        if (data[i] === 0) clear++;
      }
      if (!done && clear / all > 0.5) {
        done = true;
        down = false;
        setCleared(true);
        haptic([10, 30, 20]);
        later(() => picked.current(win, box), reducedMotion() ? 0 : 900);
      }
    };
    const onDown = (e: PointerEvent) => {
      if (done) return;
      down = true;
      last = null;
      cv.setPointerCapture(e.pointerId);
      rub(at(e));
    };
    const onMove = (e: PointerEvent) => down && !done && rub(at(e));
    const onUp = () => {
      down = false;
      last = null;
    };
    cv.addEventListener("pointerdown", onDown);
    cv.addEventListener("pointermove", onMove);
    cv.addEventListener("pointerup", onUp);
    cv.addEventListener("pointercancel", onUp);
    return () => {
      cv.removeEventListener("pointerdown", onDown);
      cv.removeEventListener("pointermove", onMove);
      cv.removeEventListener("pointerup", onUp);
      cv.removeEventListener("pointercancel", onUp);
    };
  }, [win, later, picked]);

  return (
    <div className="scratch">
      <div className="scratch-card" ref={card}>
        <Tile
          index={indexOf(win)}
          kind={kind}
          name={win.name}
          image={win.image_url}
          showIndex={false}
        />
        <canvas
          ref={canvas}
          className={`scratch-foil${cleared ? " gone" : ""}`}
          aria-label="긁는 칸"
        />
      </div>
      <p className="hint">{cleared ? "당첨!" : "손가락으로 문질러서 긁어 줘"}</p>
      <ul className="scratch-pool" aria-label="이 중 하나가 나와">
        {candidates.map((c) => (
          <li key={c.id}>{c.name}</li>
        ))}
      </ul>
    </div>
  );
}

const cssFont = (el: Element) => getComputedStyle(el).fontFamily || "sans-serif";
