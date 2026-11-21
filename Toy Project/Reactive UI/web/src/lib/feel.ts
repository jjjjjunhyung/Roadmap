/** Feedback: synthesized sound, haptics, particle bursts, text scramble, view transitions. */

export const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

// ---------------------------------------------------------------- sound (no files)

let ctx: AudioContext | null = null;
let soundOn = true;
try {
  soundOn = localStorage.getItem("sound") !== "off";
} catch {
  /* storage may be blocked */
}

export const sound = {
  get on() {
    return soundOn;
  },
  set on(v: boolean) {
    soundOn = v;
    try {
      localStorage.setItem("sound", v ? "on" : "off");
    } catch {
      /* ignore */
    }
  },
};

function tone(
  f: number,
  dur: number,
  type: OscillatorType = "sine",
  gain = 0.05,
  slide = 0,
  delay = 0,
) {
  if (!soundOn) return;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, f + slide), t + dur);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(ctx.destination);
    o.start(t);
    o.stop(t + dur + 0.03);
  } catch {
    /* audio unavailable */
  }
}

export const sfx = {
  tick: () => tone(2100, 0.022, "square", 0.012),
  tap: () => tone(420, 0.07, "sine", 0.05, 220),
  pop: () => tone(560, 0.14, "sine", 0.06, 420),
  whoosh: () => tone(900, 0.25, "triangle", 0.02, -700),
  thud: () => tone(150, 0.18, "triangle", 0.08, -70),
  chime: () => [784, 1047, 1568].forEach((f, i) => tone(f, 0.5, "sine", 0.04, 0, i * 0.08)),
};

// ---------------------------------------------------------------- haptics

const isIOS =
  /iP(hone|ad|od)/.test(navigator.userAgent) ||
  (navigator.userAgent.includes("Mac") && "ontouchend" in document);

/** Android: Vibration API. iOS 18+: toggling a native switch input ticks the Taptic Engine. */
export function haptic(pattern: number | number[] = 10) {
  try {
    if ("vibrate" in navigator && typeof navigator.vibrate === "function")
      navigator.vibrate(pattern);
    else if (isIOS) document.getElementById("hap")?.click();
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------- particles

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  s: number;
  c: string;
  life: number;
  k: number;
  rot: number;
  vr: number;
}

let parts: Particle[] = [];
let raf = 0;

function frame() {
  const cv = document.getElementById("fx") as HTMLCanvasElement | null;
  const g = cv?.getContext("2d");
  if (!cv || !g) return;
  const dpr = Math.min(2, devicePixelRatio || 1);
  if (cv.width !== innerWidth * dpr) {
    cv.width = innerWidth * dpr;
    cv.height = innerHeight * dpr;
  }
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, innerWidth, innerHeight);
  parts = parts.filter((p) => (p.life -= 1 / 60) > 0);
  for (const p of parts) {
    p.vy += 0.16;
    p.vx *= 0.985;
    p.x += p.vx;
    p.y += p.vy;
    p.rot += p.vr;
    g.globalAlpha = Math.min(1, p.life * 1.6);
    g.fillStyle = p.c;
    g.save();
    g.translate(p.x, p.y);
    g.rotate(p.rot);
    if (p.k === 0) {
      const s = p.s;
      g.beginPath();
      g.moveTo(0, -s * 0.2);
      g.bezierCurveTo(0, -s * 0.5, -s * 0.5, -s * 0.5, -s * 0.5, -s * 0.2);
      g.bezierCurveTo(-s * 0.5, s * 0.1, 0, s * 0.3, 0, s * 0.5);
      g.bezierCurveTo(0, s * 0.3, s * 0.5, s * 0.1, s * 0.5, -s * 0.2);
      g.bezierCurveTo(s * 0.5, -s * 0.5, 0, -s * 0.5, 0, -s * 0.2);
      g.fill();
    } else if (p.k === 1) g.fillRect(-p.s / 2, -p.s / 6, p.s, p.s / 3);
    else {
      g.beginPath();
      g.arc(0, 0, p.s / 3.4, 0, 7);
      g.fill();
    }
    g.restore();
  }
  raf = parts.length ? requestAnimationFrame(frame) : 0;
}

/** Hearts, ribbons and dots bursting out of an element. */
export function burst(
  el: Element | null | undefined,
  colors: readonly string[],
  n = 36,
  power = 1,
) {
  if (reducedMotion() || !el?.isConnected) return;
  const r = el.getBoundingClientRect();
  const x = r.left + r.width / 2;
  const y = r.top + r.height / 2;
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const v = (2 + Math.random() * 5.5) * power;
    parts.push({
      x,
      y,
      vx: Math.cos(a) * v,
      vy: Math.sin(a) * v - 3 * power,
      s: 5 + Math.random() * 7,
      c: colors[i % colors.length],
      life: 1 + Math.random() * 0.6,
      k: i % 3,
      rot: Math.random() * 6,
      vr: (Math.random() - 0.5) * 0.3,
    });
  }
  if (!raf) raf = requestAnimationFrame(frame);
}

export const accent = () =>
  getComputedStyle(document.documentElement).getPropertyValue("--accent").trim();

// ---------------------------------------------------------------- text & transitions

/** Shuffles Hangul syllables before settling on `text`. */
export function scramble(el: HTMLElement, text: string, ms = 650) {
  if (reducedMotion()) {
    el.textContent = text;
    return;
  }
  const start = performance.now();
  // grapheme clusters, so emoji and combined characters stay whole
  const chars = Array.from(
    new Intl.Segmenter("ko", { granularity: "grapheme" }).segment(text),
    (g) => g.segment,
  );
  const rnd = () => String.fromCharCode(0xac00 + Math.floor(Math.random() * 11172));
  const step = (now: number) => {
    const p = Math.min(1, (now - start) / ms);
    const fixed = Math.floor(p * chars.length);
    el.textContent = chars.map((c, i) => (i < fixed || c === " " ? c : rnd())).join("");
    if (p < 1) requestAnimationFrame(step);
    else el.textContent = text;
  };
  requestAnimationFrame(step);
}

/** Runs a DOM update inside a View Transition when supported. */
export async function viewTransition(update: () => void) {
  if (!document.startViewTransition || reducedMotion()) {
    update();
    return;
  }
  await document.startViewTransition(update).updateCallbackDone;
}

export const shuffle = <T>(a: readonly T[]) => {
  const b = a.slice();
  for (let i = b.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [b[i], b[j]] = [b[j], b[i]];
  }
  return b;
};
