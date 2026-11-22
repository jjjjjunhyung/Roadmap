import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { type ArchiveGuard, errorMessage, type planApi } from "../lib/api";

/** "11.22 21:04" in local time. */
function when(unix: number) {
  const d = new Date(unix * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** "iPhone · 카카오톡" from a User-Agent, enough to recognise a phone. */
function device(ua: string) {
  const os = /iPhone/.test(ua)
    ? "iPhone"
    : /iPad/.test(ua)
      ? "iPad"
      : /Android/.test(ua)
        ? "Android"
        : /Mac OS X/.test(ua)
          ? "Mac"
          : /Windows/.test(ua)
            ? "Windows"
            : "";
  const app = /KAKAOTALK/i.test(ua)
    ? "카카오톡"
    : /Instagram/.test(ua)
      ? "인스타그램"
      : /NAVER\(/.test(ua)
        ? "네이버 앱"
        : /SamsungBrowser/.test(ua)
          ? "삼성 인터넷"
          : /Edg\//.test(ua)
            ? "Edge"
            : /CriOS|Chrome\//.test(ua)
              ? "Chrome"
              : /FxiOS|Firefox\//.test(ua)
                ? "Firefox"
                : /Safari\//.test(ua)
                  ? "Safari"
                  : "";
  return [os, app].filter(Boolean).join(" · ") || "알 수 없는 기기";
}

/**
 * The birthday lock in front of the archive, for the planner: open or locked, today's misses
 * against the daily limit, recent guesses, and a way to reopen it after a lockout.
 */
export function GuardCard({
  api,
  plannerKey,
}: {
  api: ReturnType<typeof planApi>;
  plannerKey: string;
}) {
  const qc = useQueryClient();
  const queryKey = ["plan", plannerKey, "guard"];
  const q = useQuery({ queryKey, queryFn: api.guard, retry: false, refetchInterval: 60_000 });
  const reopen = useMutation({
    mutationFn: api.reopenArchive,
    onSuccess: (g) => qc.setQueryData<ArchiveGuard>(queryKey, g),
  });
  const g = q.data;
  if (!g?.enabled) return null;
  const locked = g.locked_at !== null;

  return (
    <section className="stage guard" aria-label="생일 잠금">
      <span className="label">Birthday lock</span>
      <div className={`guard-card${locked ? " locked" : ""}`}>
        <div className="guard-head">
          <b>{locked ? "잠겨 있어" : "열려 있어"}</b>
          <span className="guard-meta">
            오늘 틀린 횟수 {g.misses_today}/{g.daily_limit} · 사람 확인{" "}
            {g.turnstile ? "켜짐" : "꺼짐"}
          </span>
        </div>
        {locked && g.locked_at !== null && (
          <div className="guard-locked">
            <p>
              {when(g.locked_at)}부터 틀린 시도가 많아서 새 기기는 들어올 수 없어. 이미 들어온
              기기는 그대로 볼 수 있어. 모르는 시도라면 그대로 두고, 아는 상황이면 다시 열어 줘.
            </p>
            <button
              className="btn small accent"
              disabled={reopen.isPending}
              onClick={() => reopen.mutate()}
            >
              다시 열기
            </button>
            {reopen.isError && <p className="guard-err">{errorMessage(reopen.error)}</p>}
          </div>
        )}
        {g.recent.length === 0 ? (
          <p className="guard-empty">아직 생일을 입력한 기록이 없어.</p>
        ) : (
          <ul className="attempts">
            {g.recent.map((a, i) => (
              <li key={`${a.at}-${i}`}>
                <span className="at">{when(a.at)}</span>
                <span className="who">
                  {device(a.agent)}
                  <small>{a.address}</small>
                </span>
                <span className={`res${a.ok ? " ok" : ""}`}>{a.ok ? "입장" : "틀림"}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
