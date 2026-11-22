import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { flushSync } from "react-dom";

import { OutsideHint, PasskeyGlyph } from "../components/Passkey";
import { WeatherIcon } from "../components/Weather";
import { ApiError, type Memory, archiveApi, authApi, errorMessage, pickApi } from "../lib/api";
import { useConfig } from "../lib/config";
import { haptic, sfx, viewTransition } from "../lib/feel";
import { formatDate } from "../lib/look";
import { passkeysWork, signIn } from "../lib/passkey";

export const Route = createFileRoute("/")({ component: Home });

/** The bare domain: passkey sign-in in front of every shared course, or nothing without it. */
function Home() {
  const cfg = useConfig();
  if (cfg.isPending) return <main className="page" />;
  return cfg.data?.auth ? <Archive /> : <Landing />;
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

function Archive() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["archive"],
    queryFn: archiveApi.list,
    retry: false,
    staleTime: 60_000,
  });
  const me = useQuery({
    queryKey: ["me"],
    queryFn: authApi.me,
    retry: false,
    enabled: q.isSuccess,
  });

  // set by "로그아웃" so the sign-in shows at once, without waiting for a refetch
  const [out, setOut] = useState(false);

  if (out || (q.error instanceof ApiError && q.error.status === 401)) {
    return (
      <SignIn
        onIn={(list) =>
          viewTransition(() =>
            flushSync(() => {
              qc.setQueryData(["archive"], list);
              setOut(false);
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
      me={me.data?.name}
      onLock={async () => {
        await authApi.logout().catch(() => undefined);
        sfx.tap();
        await viewTransition(() => flushSync(() => setOut(true)));
        // nothing of the list or the person stays in memory for the next visit
        qc.removeQueries({ queryKey: ["archive"] });
        qc.removeQueries({ queryKey: ["me"] });
      }}
    />
  );
}

/** Face ID, a fingerprint or the device's screen lock; other computers get a QR code from the browser. */
function SignIn({ onIn }: { onIn: (list: Memory[]) => void }) {
  const [busy, setBusy] = useState(false);
  const [miss, setMiss] = useState<string | null>(null);
  const works = passkeysWork();

  const go = async () => {
    setBusy(true);
    setMiss(null);
    try {
      await signIn();
      const list = await archiveApi.list();
      sfx.chime();
      haptic([12, 40, 24]);
      onIn(list);
    } catch (e) {
      sfx.thud();
      haptic([30, 60, 30]);
      setMiss(errorMessage(e));
      setBusy(false);
    }
  };

  return (
    <main className="page lock">
      <header className="masthead">
        <div className="topline">
          <span className="for">for you</span>
        </div>
        <span className="label">Archive</span>
        <h1>우리의 데이트</h1>
        <p className="lede">지금까지 함께 고른 데이트가 모두 여기 있어. 등록한 기기로 들어와 줘.</p>
      </header>

      <OutsideHint />

      <div className="enter">
        <button className="btn ink enter-btn" disabled={busy || !works} onClick={go}>
          <PasskeyGlyph />
          {busy ? "확인하는 중…" : "들어가기"}
        </button>
        <p className={`hint enter-hint${miss ? " bad" : ""}`} role="status">
          {miss ??
            (works
              ? "Face ID나 지문으로 확인해. 다른 컴퓨터라면 QR로 휴대폰을 연결하면 돼."
              : "이 브라우저에서는 패스키를 쓸 수 없어. Safari나 Chrome으로 열어 줘.")}
        </p>
        <p className="hint enter-hint">처음이라면 받은 등록 링크로 먼저 들어와 줘.</p>
      </div>
    </main>
  );
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

function Memories(props: { list: Memory[]; me?: string; onLock: () => void }) {
  const { list, me, onLock } = props;
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
          <span className="for">{me ? `for ${me}` : "for you"}</span>
          <button className="btn small ghost" onClick={onLock}>
            로그아웃
          </button>
        </div>
        <span className="label">Archive</span>
        <h1>우리의 데이트</h1>
        <p className="lede">
          {list.length > 0
            ? `함께 고른 코스 ${list.length}개. 누르면 그날의 티켓을 다시 볼 수 있어.`
            : "아직 함께 고른 데이트가 없어. 링크를 받으면 여기에 모여."}
        </p>
      </header>

      {sections.map(
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
  const photos = m.stops.flatMap((s) => (s.image_url ? [s.image_url] : [])).slice(0, 4);
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
