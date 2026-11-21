import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";

import { Itinerary, Masthead, ResultSheet, Ticket, Toast } from "../components/ui";
import { GAMES } from "../games";
import { ApiError, type PickView, type Place, errorMessage, pickApi } from "../lib/api";
import { accent, burst, haptic, reducedMotion, sfx, viewTransition } from "../lib/feel";
import { aura } from "../lib/look";

export const Route = createFileRoute("/p/$code")({ component: Picker });

/** Local view right after a pick, until the server sends the next step. */
function applyPick(v: PickView, stepId: string, place: Place): PickView {
  const steps = v.steps.map((s) =>
    s.id === stepId ? { ...s, state: "done" as const, picked: place } : s,
  );
  const finished = steps.every((s) => s.state === "done");
  return { ...v, steps, current: null, status: finished ? "done" : v.status, pending: !finished };
}

function Picker() {
  const { code } = Route.useParams();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["pick", code],
    queryFn: () => pickApi.view(code),
    staleTime: Infinity,
    retry: (n, e) => !(e instanceof ApiError && e.status < 500) && n < 2,
  });
  const [result, setResult] = useState<Place | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [morph, setMorph] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const sealRef = useRef<HTMLSpanElement>(null);
  const prevStatus = useRef<string | undefined>(undefined);
  const clearToast = useCallback(() => setToast(null), []);

  const v = q.data;
  const cur = v?.current ?? null;
  const indexOf = useCallback(
    (p: Place) => Math.max(0, cur?.candidates.findIndex((c) => c.id === p.id) ?? 0),
    [cur],
  );

  const onPicked = useCallback(
    (p: Place, el: Element | null) => {
      haptic([20, 40, 30]);
      sfx.chime();
      burst(el, [...aura(indexOf(p)), accent()], 40);
      window.setTimeout(() => setResult(p), reducedMotion() ? 0 : 420);
    },
    [indexOf],
  );

  // the seal lands when the last pick completes the course
  useEffect(() => {
    if (v?.status === "done" && prevStatus.current === "open") {
      const t = window.setTimeout(() => {
        sfx.thud();
        haptic([10, 30, 60]);
        burst(sealRef.current, [accent(), "#e29aa8", "#f4d3c6", "#ffffff"], 70, 1.25);
      }, 600);
      prevStatus.current = v.status;
      return () => clearTimeout(t);
    }
    prevStatus.current = v?.status;
  }, [v?.status]);

  const confirm = async () => {
    if (!v || !cur || !result) return;
    const place = result;
    const stepId = cur.id;
    sfx.pop();
    haptic(15);
    const src = document.getElementById("morph-src");
    if (src) src.style.viewTransitionName = "picked";
    await viewTransition(() =>
      flushSync(() => {
        setResult(null);
        setMorph(stepId);
        setAttempt(0);
        qc.setQueryData<PickView>(["pick", code], applyPick(v, stepId, place));
      }),
    );
    try {
      qc.setQueryData(["pick", code], await pickApi.choose(code, stepId, place.id));
    } catch (e) {
      setToast(errorMessage(e));
      void qc.invalidateQueries({ queryKey: ["pick", code] });
    }
    window.setTimeout(() => setMorph(null), 950);
  };

  const retry = async () => {
    if (!v || !cur) return;
    sfx.whoosh();
    try {
      const { rerolls_left } = await pickApi.reroll(code, cur.id);
      qc.setQueryData<PickView>(["pick", code], { ...v, current: { ...cur, rerolls_left } });
      setResult(null);
      setAttempt((a) => a + 1);
    } catch (e) {
      setToast(errorMessage(e));
    }
  };

  if (q.isPending) {
    return (
      <main className="page">
        <p className="hint" style={{ paddingTop: 120 }}>
          불러오는 중…
        </p>
      </main>
    );
  }
  if (q.isError || !v) {
    return (
      <main className="page">
        <div className="message">
          <h2>링크를 다시 확인해 줘</h2>
          <p>{errorMessage(q.error)}</p>
        </div>
      </main>
    );
  }
  if (v.status === "draft") {
    return (
      <main className="page">
        <Masthead date={v.date} title={v.title} />
        <div className="message">
          <h2>아직 준비 중이야</h2>
          <p>조금만 기다려 줘. 준비가 끝나면 이 링크에서 바로 시작할 수 있어.</p>
        </div>
      </main>
    );
  }

  const game = cur ? GAMES[cur.game] : undefined;
  const position = cur ? v.steps.findIndex((s) => s.id === cur.id) + 1 : 0;

  return (
    <main className="page">
      <Masthead
        date={v.date}
        title={v.title}
        lede={
          v.status === "done"
            ? undefined
            : "준비해 둔 선택지 중에서 하나씩 골라 줘. 다 고르면 오늘의 코스가 완성돼."
        }
      />
      <Itinerary steps={v.steps} morph={morph} />

      {v.status === "done" ? (
        <Ticket date={v.date} steps={v.steps} sealRef={sealRef} />
      ) : cur && game ? (
        <section className="stage" aria-live="polite">
          <div className="stage-head">
            <span className="label">
              Step {position} of {v.steps.length} — {cur.label}
            </span>
            <h2>{cur.title}</h2>
          </div>
          <p className="note">
            <span>{game.name}</span>
            {game.luck ? (
              <span>
                다시 하기 <b>{cur.rerolls_left}</b>번
              </span>
            ) : (
              <span>직접 고르기</span>
            )}
          </p>
          <div className="game">
            <game.Component
              key={`${cur.id}-${attempt}`}
              candidates={cur.candidates}
              kind={cur.kind}
              indexOf={indexOf}
              onPicked={onPicked}
            />
          </div>
        </section>
      ) : cur ? (
        <div className="message">
          <h2>이 단계는 아직 열 수 없어</h2>
          <p>준비한 사람에게 알려 줘.</p>
        </div>
      ) : (
        <p className="hint">다음 단계를 여는 중…</p>
      )}

      {result && cur && game && (
        <ResultSheet
          place={result}
          index={indexOf(result)}
          kind={cur.kind}
          heading={`${game.name} · ${cur.label}`}
          rerollsLeft={game.luck ? cur.rerolls_left : null}
          onRetry={retry}
          onConfirm={confirm}
        />
      )}
      <Toast message={toast} onDone={clearToast} />
    </main>
  );
}
