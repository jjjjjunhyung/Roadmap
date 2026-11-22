import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { OutsideHint, PasskeyGlyph } from "../components/Passkey";
import { authApi, errorMessage } from "../lib/api";
import { haptic, sfx } from "../lib/feel";
import { passkeysWork, registerDevice } from "../lib/passkey";

export const Route = createFileRoute("/join/$token")({ component: Join });

/** "21:40" for a unix time. */
function clock(unix: number) {
  const d = new Date(unix * 1000);
  return `${d.getMonth() + 1}.${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/**
 * A single-use link from the planner: registers this device's passkey, or (where passkeys cannot
 * work) opens a short session once.
 */
function Join() {
  const { token } = Route.useParams();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const q = useQuery({
    queryKey: ["invite", token],
    queryFn: () => authApi.invite(token),
    retry: false,
    staleTime: Infinity,
  });
  const [busy, setBusy] = useState<"register" | "enter" | null>(null);
  const [miss, setMiss] = useState<string | null>(null);
  const works = passkeysWork();

  const done = async () => {
    sfx.chime();
    haptic([12, 40, 24]);
    qc.removeQueries({ queryKey: ["archive"] });
    qc.removeQueries({ queryKey: ["me"] });
    await navigate({ to: "/", replace: true });
  };
  const run = async (kind: "register" | "enter") => {
    setBusy(kind);
    setMiss(null);
    try {
      if (kind === "register") await registerDevice(token);
      else await authApi.enter(token);
      await done();
    } catch (e) {
      sfx.thud();
      haptic([30, 60, 30]);
      setMiss(errorMessage(e));
      setBusy(null);
    }
  };

  if (q.isPending) return <main className="page" />;
  if (q.isError) {
    return (
      <main className="page">
        <div className="message">
          <h2>링크를 쓸 수 없어</h2>
          <p>{errorMessage(q.error)}</p>
          <Link className="btn small ghost" to="/">
            처음 화면으로
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="page lock">
      <header className="masthead">
        <div className="topline">
          <span className="for">for {q.data.name}</span>
        </div>
        <span className="label">New device</span>
        <h1>이 기기를 등록할게</h1>
        <p className="lede">
          한 번 등록하면 다음부터는 {location.host}에서 Face ID나 지문 한 번으로 들어와.
        </p>
      </header>

      <OutsideHint />

      <div className="enter">
        <button
          className="btn ink enter-btn"
          disabled={busy !== null || !works}
          onClick={() => void run("register")}
        >
          <PasskeyGlyph />
          {busy === "register" ? "등록하는 중…" : "이 기기 등록하기"}
        </button>
        <p className={`hint enter-hint${miss ? " bad" : ""}`} role="status">
          {miss ??
            (works
              ? `이 링크는 ${clock(q.data.expires_at)}까지 한 번만 쓸 수 있어.`
              : "이 브라우저에서는 패스키를 쓸 수 없어. Safari나 Chrome으로 열어 줘.")}
        </p>
        <button className="enter-alt" disabled={busy !== null} onClick={() => void run("enter")}>
          {busy === "enter" ? "들어가는 중…" : "등록 없이 이번만 들어가기 · 7일"}
        </button>
      </div>
    </main>
  );
}
