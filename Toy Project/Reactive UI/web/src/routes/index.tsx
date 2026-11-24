import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { type CSSProperties, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";

import {
  ApiError,
  type Memory,
  archiveApi,
  errorMessage,
  photoUrl,
  pickApi,
  wishApi,
} from "../lib/api";
import { Envelope, type EnvelopeHandle } from "../components/Envelope";
import { useTurnstile } from "../components/Turnstile";
import { WeatherIcon } from "../components/Weather";
import { Wishlist } from "../components/Wishlist";
import { useConfig } from "../lib/config";
import { haptic, sfx, viewTransition } from "../lib/feel";
import { formatDate } from "../lib/look";

export const Route = createFileRoute("/")({ component: Home });

/** The bare domain: a birthday lock in front of every shared course, or nothing without one. */
function Home() {
  const cfg = useConfig();
  if (cfg.isPending) return <main className="page" />;
  const digits = cfg.data?.archive_digits;
  return digits ? (
    <Archive digits={digits} siteKey={cfg.data?.turnstile_site_key ?? null} />
  ) : (
    <Landing />
  );
}

function Landing() {
  return (
    <main className="page">
      <header className="masthead">
        <div className="topline">
          <span className="for">for you</span>
        </div>
        <p className="date">Date</p>
        <h1>코스를 준비하고 있어</h1>
        <p className="lede">받은 링크로 들어와 줘.</p>
      </header>
    </main>
  );
}

function Archive({ digits, siteKey }: { digits: number; siteKey: string | null }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["archive"],
    queryFn: archiveApi.list,
    retry: false,
    staleTime: 60_000,
  });

  // set by "잠그기" so the lock shows at once, without waiting for a refetch
  const [locked, setLocked] = useState(false);

  if (locked || (q.error instanceof ApiError && q.error.status === 401)) {
    return (
      <Lock
        digits={digits}
        siteKey={siteKey}
        onOpen={(list) =>
          viewTransition(() =>
            flushSync(() => {
              qc.setQueryData(["archive"], list);
              setLocked(false);
            }),
          )
        }
      />
    );
  }
  if (q.isPending) return <main className="page" />;
  if (q.isError) {
    return (
      <main className="page">
        <div className="message">
          <h2>불러오지 못했어</h2>
          <p>{errorMessage(q.error)}</p>
        </div>
      </main>
    );
  }
  return (
    <Memories
      list={q.data}
      onLock={async () => {
        await archiveApi.lock().catch(() => undefined);
        sfx.tap();
        await viewTransition(() => flushSync(() => setLocked(true)));
        // the list must not come back from memory on the next visit to this page
        qc.removeQueries({ queryKey: ["archive"] });
      }}
    />
  );
}

/** How the digits are grouped and named: 6 → YY MM DD, 8 → YYYY MM DD, 4 → MM DD. */
function groupsOf(digits: number): [number, string][] {
  if (digits === 6)
    return [
      [2, "YY"],
      [2, "MM"],
      [2, "DD"],
    ];
  if (digits === 8)
    return [
      [4, "YYYY"],
      [2, "MM"],
      [2, "DD"],
    ];
  if (digits === 4)
    return [
      [2, "MM"],
      [2, "DD"],
    ];
  return [[digits, ""]];
}

/** The groups with the input positions each one shows. */
function cellsOf(digits: number) {
  const out: { name: string; cells: number[] }[] = [];
  let at = 0;
  for (const [size, name] of groupsOf(digits)) {
    out.push({ name, cells: Array.from({ length: size }, (_, k) => at + k) });
    at += size;
  }
  return out;
}

const SPOKEN: Record<number, string> = { 4: "네", 6: "여섯", 8: "여덟" };

/**
 * The birthday, typed into one real input laid over large printed digits (like the date on a
 * course card). It checks itself once every digit is in; a wrong code shakes and clears.
 */
function Lock(props: { digits: number; siteKey: string | null; onOpen: (list: Memory[]) => void }) {
  const { digits, siteKey, onOpen } = props;
  const humanBox = useRef<HTMLDivElement>(null);
  const human = useTurnstile(siteKey, humanBox);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [opening, setOpening] = useState(false);
  const envelope = useRef<EnvelopeHandle>(null);
  const [miss, setMiss] = useState<{ n: number; text: string; wrong: boolean } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  // after a miss the server makes this device wait; the countdown survives a reload
  const [until, setUntil] = useState(readWait);
  const [now, setNow] = useState(() => Date.now());
  const waiting = until > now;
  useEffect(() => {
    if (!until) return;
    const t = window.setInterval(() => {
      const n = Date.now();
      setNow(n);
      if (n >= until) {
        setUntil(0);
        writeWait(0);
        input.current?.focus();
      }
    }, 250);
    return () => clearInterval(t);
  }, [until]);

  const submit = async (value: string) => {
    setBusy(true);
    try {
      await archiveApi.unlock(value, await human.token());
      const list = await archiveApi.list();
      sfx.chime();
      haptic([12, 40, 24]);
      setOpening(true);
      await envelope.current?.open(list.map((m) => ({ date: m.date, title: m.title })));
      onOpen(list);
    } catch (e) {
      sfx.thud();
      haptic([30, 60, 30]);
      envelope.current?.shake();
      setMiss((m) => ({
        n: (m?.n ?? 0) + 1,
        text: errorMessage(e),
        wrong: e instanceof ApiError && e.status === 403,
      }));
      if (e instanceof ApiError && e.retryAfter) {
        const u = Date.now() + e.retryAfter * 1000;
        setNow(Date.now());
        setUntil(u);
        writeWait(u);
      }
      human.reset();
      setCode("");
      setBusy(false);
      input.current?.focus();
    }
  };

  const change = (raw: string) => {
    const next = raw.replace(/\D/g, "").slice(0, digits);
    if (next.length > code.length) {
      sfx.tick();
      envelope.current?.hop();
    }
    setCode(next);
    if (next.length === digits) void submit(next);
  };

  const groups = cellsOf(digits);

  return (
    <main className="page lock">
      <header className="masthead">
        <div className="topline">
          <span className="for">for you</span>
        </div>
        <span className="label">Archive</span>
        <h1>생일을 눌러 줘</h1>
        <p className="lede">지금까지 함께 고른 데이트가 모두 여기 있어.</p>
      </header>

      <Envelope
        ref={envelope}
        filled={code.length}
        total={digits}
        busy={busy}
        waiting={waiting}
        onPress={() => input.current?.focus()}
      />

      <div
        key={miss?.n ?? 0}
        className={`pin${miss ? " missed" : ""}${busy ? " busy" : ""}${waiting ? " waiting" : ""}`}
        style={{ "--cells": digits + (groups.length - 1) * 0.45 } as CSSProperties}
        onClick={() => input.current?.focus()}
      >
        <div className="pin-digits" aria-hidden="true">
          {groups.map((g, gi) => (
            <span key={g.name || gi} className="pin-group">
              {gi > 0 && <span className="pin-dot">.</span>}
              <span className="pin-cells">
                {g.cells.map((i) => (
                  <span
                    key={i}
                    className={`pin-cell${i < code.length ? " on" : ""}${i === code.length && !busy && !waiting ? " here" : ""}`}
                  >
                    {code[i] ?? "0"}
                  </span>
                ))}
              </span>
              {g.name && <span className="pin-name">{g.name}</span>}
            </span>
          ))}
        </div>
        <input
          ref={input}
          className="pin-input"
          value={code}
          onChange={(e) => change(e.target.value)}
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="off"
          enterKeyHint="done"
          maxLength={digits}
          disabled={busy || waiting}
          aria-label={`생일 ${digits}자리`}
          autoFocus
        />
      </div>

      <p className={`hint pin-hint${miss ? " bad" : ""}`} role="status">
        {opening
          ? "열렸어"
          : busy
            ? "확인하는 중…"
            : waiting
              ? `${miss?.wrong ? "아니야. " : ""}${mmss(until - now)} 뒤에 다시 할 수 있어`
              : until === 0 && miss?.wrong
                ? "이제 다시 눌러 줘"
                : miss
                  ? miss.text
                  : `생일 ${SPOKEN[digits] ?? digits} 자리`}
      </p>
      {/* Cloudflare's check: empty unless it asks for a click */}
      <div className="ts-box" ref={humanBox} />
    </main>
  );
}

const WAIT_KEY = "archive-wait-until";

/** When this device may try again (ms), if it is still waiting. */
function readWait() {
  try {
    const v = Number(localStorage.getItem(WAIT_KEY) ?? 0);
    return v > Date.now() ? v : 0;
  } catch {
    return 0;
  }
}

function writeWait(until: number) {
  try {
    if (until) localStorage.setItem(WAIT_KEY, String(until));
    else localStorage.removeItem(WAIT_KEY);
  } catch {
    /* private mode: the server still enforces the wait */
  }
}

/** "14:59" from milliseconds. */
function mmss(ms: number) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Days from today to an ISO date: negative once it has passed. */
function daysTo(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Math.round((new Date(y, m - 1, d).getTime() - today) / 86_400_000);
}

/** "D-3", "오늘", or nothing for days already past. */
function dday(iso: string) {
  const n = daysTo(iso);
  return n === 0 ? "오늘" : n > 0 ? `D-${n}` : null;
}

const VIEW_KEY = "archive-view";
type View = "dates" | "wishes";

function readView(): View {
  try {
    return localStorage.getItem(VIEW_KEY) === "wishes" ? "wishes" : "dates";
  } catch {
    return "dates";
  }
}

function Memories({ list, onLock }: { list: Memory[]; onLock: () => void }) {
  const [view, setView] = useState<View>(readView);
  const wishes = useQuery({ queryKey: ["wishes"], queryFn: wishApi.list, retry: false });
  const show = (v: View) => {
    setView(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* the tab just won't be remembered */
    }
  };
  const done = list.filter((m) => m.status === "done");
  const sections = [
    // still being chosen, then finished ones still ahead (soonest first), then the past
    { name: "고르는 중", items: list.filter((m) => m.status === "open") },
    { name: "다가오는 데이트", items: done.filter((m) => daysTo(m.date) >= 0).reverse() },
    { name: "지난 데이트", items: done.filter((m) => daysTo(m.date) < 0) },
  ];
  return (
    <main className="page">
      <header className="masthead">
        <div className="topline">
          <span className="for">for you</span>
          <button className="btn small ghost" onClick={onLock}>
            잠그기
          </button>
        </div>
        <span className="label">Archive</span>
        <h1>우리의 데이트</h1>
        <p className="lede">
          {view === "wishes"
            ? "가 보고 싶은 곳을 모아 두는 곳이야."
            : list.length > 0
              ? `함께 고른 코스 ${list.length}개. 누르면 그날의 티켓을 다시 볼 수 있어.`
              : "아직 함께 고른 데이트가 없어. 링크를 받으면 여기에 모여."}
        </p>
      </header>

      <div className="seg" role="tablist" aria-label="보기">
        <button role="tab" aria-selected={view === "dates"} onClick={() => show("dates")}>
          데이트 <i>{list.length}</i>
        </button>
        <button role="tab" aria-selected={view === "wishes"} onClick={() => show("wishes")}>
          가고 싶은 곳 <i>{wishes.data?.length ?? ""}</i>
        </button>
      </div>

      {view === "wishes" && <Wishlist />}
      {view === "dates" &&
        sections.map(
          (s) =>
            s.items.length > 0 && (
              <section key={s.name} className="memories" aria-label={s.name}>
                <span className="label">{s.name}</span>
                <ul>
                  {s.items.map((m) => (
                    <MemoryCard key={m.share_code} m={m} />
                  ))}
                </ul>
              </section>
            ),
        )}
    </main>
  );
}

/** A ticket stub: the date on the left, the course and its photos on the right. */
function MemoryCard({ m }: { m: Memory }) {
  const d = formatDate(m.date);
  const year = m.date.slice(0, 4);
  const soon = dday(m.date);
  const picked = m.stops.filter((s) => s.name !== null).length;
  // our own photos of the day first; otherwise the places' photos from the map
  const ours = m.photos.map((id) => photoUrl(id, true));
  const photos = (
    ours.length ? ours : m.stops.flatMap((s) => (s.image_url ? [s.image_url] : []))
  ).slice(0, 4);
  return (
    <li>
      <Link className="memory" to="/p/$code" params={{ code: m.share_code }}>
        <span className="stub" aria-label={d.full}>
          <b>{d.md}</b>
          <small>{d.dow}</small>
          <StubWeather code={m.share_code} />
          <small className={`yr${soon ? " soon" : ""}`}>{soon ?? year}</small>
        </span>
        <span className="body">
          <b className="ttl">{m.title}</b>
          <span className="route">
            {m.stops.map((s, i) => (
              <span key={i} className={s.name ? "" : "todo"}>
                {s.name ?? s.label}
              </span>
            ))}
          </span>
          <span className="foot">
            {photos.length > 0 && (
              <span className="thumbs" aria-hidden="true">
                {photos.map((src) => (
                  <Thumb key={src} src={src} />
                ))}
              </span>
            )}
            {m.status === "open" && (
              <span className="status" data-s="open">
                {picked}/{m.stops.length} · 이어서 고르기
              </span>
            )}
          </span>
        </span>
      </Link>
    </li>
  );
}

/** The day's sky and high on a stub (what it was like, or the forecast). */
function StubWeather({ code }: { code: string }) {
  const q = useQuery({
    queryKey: ["weather", code],
    queryFn: () => pickApi.weather(code),
    staleTime: 30 * 60_000,
    retry: false,
  });
  const d = q.data?.day;
  if (!d) return null;
  return (
    <small className="wx-stub">
      <WeatherIcon code={d.code} />
      {Math.round(d.max)}°
    </small>
  );
}

function Thumb({ src }: { src: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  );
}
