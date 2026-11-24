import {
  type CSSProperties,
  type Ref,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { flushSync } from "react-dom";

import { accent, burst, reducedMotion, sfx } from "../lib/feel";
import { formatDate } from "../lib/look";

export interface EnvelopeCard {
  date: string;
  title: string;
}

export interface EnvelopeHandle {
  /** a digit went in: a small hop */
  hop(): void;
  /** the birthday was wrong: it shakes its head */
  shake(): void;
  /** the birthday was right: the seal breaks, the flap opens and these courses rise out */
  open(cards: EnvelopeCard[]): Promise<void>;
}

const wait = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));
const clamp = (v: number) => Math.max(-1, Math.min(1, v));

/**
 * The sealed envelope over the birthday lock. Its seal fills digit by digit; the right birthday
 * opens it and the latest courses rise out before the archive takes over. It holds nothing until
 * then: the cards only get their dates and titles from the list the unlock returns.
 */
export function Envelope(props: {
  ref?: Ref<EnvelopeHandle>;
  filled: number;
  total: number;
  busy: boolean;
  waiting: boolean;
  onPress?: () => void;
}) {
  const { ref, filled, total, busy, waiting, onPress } = props;
  const hopRef = useRef<HTMLDivElement>(null);
  const envRef = useRef<HTMLDivElement>(null);
  const flapRef = useRef<HTMLDivElement>(null);
  const sealRef = useRef<HTMLDivElement>(null);
  const cardsRef = useRef<HTMLDivElement>(null);
  const [cards, setCards] = useState<(EnvelopeCard | null)[]>([null, null, null]);
  const [opened, setOpened] = useState(false);

  useImperativeHandle(
    ref,
    () => ({
      hop() {
        if (reducedMotion()) return;
        hopRef.current?.animate(
          [
            { transform: "translateY(0) scale(1)" },
            { transform: "translateY(-9px) scale(1.02)", offset: 0.4 },
            { transform: "translateY(0) scale(1)" },
          ],
          { duration: 320, easing: "cubic-bezier(.3,.7,.4,1)" },
        );
      },
      shake() {
        if (reducedMotion()) return;
        hopRef.current?.animate(
          [
            { transform: "translateX(0) rotate(0deg)" },
            { transform: "translateX(-13px) rotate(-3.5deg)" },
            { transform: "translateX(11px) rotate(3deg)" },
            { transform: "translateX(-7px) rotate(-1.8deg)" },
            { transform: "translateX(4px) rotate(1deg)" },
            { transform: "translateX(0) rotate(0deg)" },
          ],
          { duration: 580, easing: "ease-out" },
        );
      },
      async open(list) {
        const seal = sealRef.current;
        const flap = flapRef.current;
        const box = cardsRef.current;
        if (reducedMotion() || !seal || !flap || !box) return;
        // the newest course in front
        const shown = list.slice(0, 3).reverse();
        flushSync(() => {
          setCards(shown.length ? shown : [null]);
          setOpened(true);
        });
        sfx.pop();
        seal.animate(
          [{ transform: "scale(1)" }, { transform: "scale(1.25)" }, { transform: "scale(1)" }],
          {
            duration: 280,
            easing: "ease-out",
          },
        );
        burst(seal, [accent(), "#e29aa8", "#f4d3c6"], 28, 0.8);
        await wait(250);
        seal.animate(
          [
            { transform: "translateY(0) rotate(0deg)", opacity: 1 },
            { transform: "translateY(96px) rotate(40deg)", opacity: 0 },
          ],
          { duration: 520, easing: "cubic-bezier(.55,0,.8,.3)", fill: "forwards" },
        );
        flap.animate(
          [
            { transform: "perspective(700px) rotateX(0deg)" },
            { transform: "perspective(700px) rotateX(180deg)" },
          ],
          { duration: 560, easing: "cubic-bezier(.45,0,.25,1)", fill: "forwards" },
        );
        // past upright, the flap goes behind the cards
        window.setTimeout(() => (flap.style.zIndex = "0"), 280);
        await wait(420);
        sfx.whoosh();
        const els = [...box.children] as HTMLElement[];
        const fan = els.length === 1 ? [0] : els.length === 2 ? [-6, 6] : [-9, 2, 10];
        els.forEach((el, i) =>
          el.animate(
            [
              { transform: "translateY(0) rotate(0deg)" },
              { transform: `translateY(${-104 - i * 12}px) rotate(${fan[i]}deg)` },
            ],
            {
              duration: 660,
              delay: i * 120,
              easing: "cubic-bezier(.34,1.4,.64,1)",
              fill: "forwards",
            },
          ),
        );
        await wait(880 + els.length * 120);
      },
    }),
    [],
  );

  // it leans toward the mouse, or with the phone where the browser shares its tilt freely
  useEffect(() => {
    const env = envRef.current;
    if (!env || reducedMotion()) return;
    let raf = 0;
    let rx = 0;
    let ry = 0;
    const set = (x: number, y: number) => {
      rx = x;
      ry = y;
      raf ||= requestAnimationFrame(() => {
        raf = 0;
        env.style.setProperty("--rx", `${rx.toFixed(2)}deg`);
        env.style.setProperty("--ry", `${ry.toFixed(2)}deg`);
      });
    };
    const move = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      const r = env.getBoundingClientRect();
      set(
        -clamp((e.clientY - (r.top + r.height / 2)) / (innerHeight / 2)) * 12,
        clamp((e.clientX - (r.left + r.width / 2)) / (innerWidth / 2)) * 16,
      );
    };
    const leave = () => set(0, 0);
    const tilt = (e: DeviceOrientationEvent) => {
      if (e.beta === null || e.gamma === null) return;
      set(-clamp((e.beta - 45) / 35) * 10, clamp(e.gamma / 35) * 14);
    };
    window.addEventListener("pointermove", move);
    document.documentElement.addEventListener("pointerleave", leave);
    window.addEventListener("deviceorientation", tilt);
    return () => {
      window.removeEventListener("pointermove", move);
      document.documentElement.removeEventListener("pointerleave", leave);
      window.removeEventListener("deviceorientation", tilt);
      cancelAnimationFrame(raf);
    };
  }, []);

  const state = opened ? " opened" : waiting ? " waiting" : busy ? " busy" : "";
  return (
    <div
      className={`envelope${state}`}
      style={{ "--seal": total ? filled / total : 0 } as CSSProperties}
      aria-hidden="true"
      onClick={onPress}
    >
      <div className="env-ground" />
      <div className="env-float">
        <div className="env-hop" ref={hopRef}>
          <div className="env" ref={envRef}>
            <div className="env-back" />
            <div className="env-flap" ref={flapRef} />
            <div className="env-cards" ref={cardsRef}>
              {cards.map((c, i) => (
                <div className="env-card" key={c ? `${c.date}-${i}` : i}>
                  {c && (
                    <>
                      <b>{formatDate(c.date).md}</b>
                      <span>{c.title}</span>
                    </>
                  )}
                  <i />
                  <i />
                </div>
              ))}
            </div>
            <div className="env-front">
              <svg viewBox="0 0 232 150" preserveAspectRatio="none">
                <path d="M0 150 L116 88 L232 150" />
              </svg>
            </div>
            <div className="env-seal" ref={sealRef}>
              <span>
                <svg viewBox="0 0 24 24">
                  <path d="M12 21s-7.5-4.6-9.6-9.2C.9 8.4 3 4.5 6.7 4.5c2.1 0 3.6 1.1 4.3 2.4h2c.7-1.3 2.2-2.4 4.3-2.4 3.7 0 5.8 3.9 4.3 7.3C19.5 16.4 12 21 12 21z" />
                </svg>
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
