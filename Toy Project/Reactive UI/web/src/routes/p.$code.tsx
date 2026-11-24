import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";

import { Album } from "../components/Album";
import { CandidateMap, CourseMap } from "../components/Maps";
import { WeatherStrip } from "../components/Weather";
import { Itinerary, Masthead, ResultSheet, Ticket, Toast, Tile } from "../components/ui";
import { GAMES } from "../games";
import {
  ApiError,
  type OpenStep,
  type PickView,
  type Place,
  type StepSummary,
  errorMessage,
  pickApi,
} from "../lib/api";
import { useConfig } from "../lib/config";
import { accent, burst, haptic, reducedMotion, sfx, viewTransition } from "../lib/feel";
import { aura } from "../lib/look";

export const Route = createFileRoute("/p/$code")({ component: Picker });

/** Local view right after a pick, until the server answers. */
function applyPick(v: PickView, stepId: string, place: Place): PickView {
  const steps = v.steps.map((s) =>
    s.id === stepId ? { ...s, state: "done" as const, picked: place } : s,
  );
  const open = v.open.filter((s) => s.id !== stepId);
  return { ...v, steps, open, status: open.length === 0 ? "done" : v.status };
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
  const [playing, setPlaying] = useState<string | null>(null);
  const [result, setResult] = useState<Place | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [morph, setMorph] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [focus, setFocus] = useState<string[]>([]);
  const home = !!useConfig().data?.archive_digits;
  const wx = useQuery({
    queryKey: ["weather", code],
    queryFn: () => pickApi.weather(code),
    staleTime: 30 * 60_000,
    retry: 1,
  });
  const sealRef = useRef<HTMLSpanElement>(null);
  const stageRef = useRef<HTMLElement>(null);
  const prevStatus = useRef<string | undefined>(undefined);
  const clearToast = useCallback(() => setToast(null), []);

  const v = q.data;
  // the step being played; gone (picked elsewhere, or reloaded) means back to the day
  const cur = v?.open.find((s) => s.id === playing) ?? null;
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

  /** Back to the top of the stage when it changes between the day and a game. */
  const toStage = () =>
    requestAnimationFrame(() => {
      const el = stageRef.current;
      if (el && el.getBoundingClientRect().top < 0) {
        el.scrollIntoView({ block: "start", behavior: reducedMotion() ? "auto" : "smooth" });
      }
    });

  const play = (s: OpenStep) => {
    sfx.tick();
    haptic(8);
    setResult(null);
    setAttempt(0);
    setFocus([]);
    setPlaying(s.id);
    toStage();
  };

  const backToDay = () => {
    sfx.tick();
    setResult(null);
    setFocus([]);
    setPlaying(null);
    toStage();
  };

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
        setFocus([]);
        setPlaying(null);
        qc.setQueryData<PickView>(["pick", code], applyPick(v, stepId, place));
      }),
    );
    toStage();
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
      qc.setQueryData<PickView>(["pick", code], {
        ...v,
        open: v.open.map((s) => (s.id === cur.id ? { ...s, rerolls_left } : s)),
      });
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
        <Masthead date={v.date} title={v.title} home={home} />
        <WeatherStrip report={wx.data} />
        <div className="message">
          <h2>아직 준비 중이야</h2>
          <p>조금만 기다려 줘. 준비가 끝나면 이 링크에서 바로 시작할 수 있어.</p>
        </div>
      </main>
    );
  }

  const game = cur ? GAMES[cur.game] : undefined;
  const anyFixed = v.steps.some((s) => s.state === "fixed");

  return (
    <main className="page">
      <Masthead
        date={v.date}
        title={v.title}
        home={home}
        lede={
          v.status === "done"
            ? undefined
            : anyFixed
              ? "정해 둔 곳도 있고, 네가 고를 곳도 있어. 끌리는 것부터 골라 줘. 다 고르면 오늘의 코스가 완성돼."
              : "준비해 둔 선택지 중에서 끌리는 것부터 골라 줘. 다 고르면 오늘의 코스가 완성돼."
        }
      />
      <WeatherStrip report={wx.data} />
      <Itinerary steps={v.steps} morph={morph} playing={cur?.id ?? null} />

      {v.status === "done" ? (
        <>
          <Ticket date={v.date} steps={v.steps} sealRef={sealRef} weather={wx.data} />
          <CourseMap steps={v.steps} />
          <Album code={code} steps={v.steps} />
        </>
      ) : cur && game ? (
        <section className="stage" aria-live="polite" ref={stageRef}>
          <div className="stage-head">
            <div className="stage-top">
              <span className="label">
                {cur.time ? `${cur.time} · ` : ""}
                {cur.label}
              </span>
              {v.open.length > 1 && (
                <button className="btn small ghost" onClick={backToDay}>
                  ← 다른 것부터
                </button>
              )}
            </div>
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
          <CandidateMap key={cur.id} candidates={cur.candidates} indexOf={indexOf} focus={focus} />
          <div className="game">
            <game.Component
              key={`${cur.id}-${attempt}`}
              candidates={cur.candidates}
              kind={cur.kind}
              indexOf={indexOf}
              onPicked={onPicked}
              onFocus={setFocus}
            />
          </div>
        </section>
      ) : (
        <section className="stage" aria-live="polite" ref={stageRef}>
          <Day steps={v.steps} open={v.open} onPlay={play} />
        </section>
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

/**
 * The whole day at a glance: places already decided (by the planner, or by her earlier) and the
 * steps still to choose, each opening its game in whatever order she likes.
 */
function Day(props: { steps: StepSummary[]; open: OpenStep[]; onPlay: (s: OpenStep) => void }) {
  const { steps, open, onPlay } = props;
  const left = open.length;
  return (
    <div className="day">
      <div className="day-head">
        <span className="label">오늘 하루</span>
        <span className="day-left">
          고를 곳 <b>{left}</b>
          {left > 1 && " · 순서는 마음대로"}
        </span>
      </div>
      <ol className="day-list">
        {steps.map((s, i) => {
          const o = open.find((x) => x.id === s.id);
          if (o) return <OpenRow key={s.id} step={o} onPlay={onPlay} />;
          const p = s.picked;
          return (
            <li key={s.id} className="day-row" data-state={s.state}>
              <span className="tm">{s.time || "—"}</span>
              <div className="what">
                <span className="kind">
                  {s.label}
                  <i className="tag">{s.state === "fixed" ? "정해 둠" : "네가 골랐어"}</i>
                </span>
                <b>{p?.name}</b>
                {p?.memo && <span className="memo">{p.memo}</span>}
              </div>
              {p && (
                <Tile
                  index={i}
                  kind={s.kind}
                  image={p.image_url}
                  showIndex={false}
                  className="day-tile"
                />
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function OpenRow({ step, onPlay }: { step: OpenStep; onPlay: (s: OpenStep) => void }) {
  const game = GAMES[step.game];
  const ready = !!game && step.candidates.length >= 2;
  return (
    <li className="day-row" data-state="open">
      <button className="day-open" disabled={!ready} onClick={() => onPlay(step)}>
        <span className="tm">{step.time || "—"}</span>
        <span className="what">
          <span className="kind">
            {step.label}
            <i className="tag">{ready ? "고를 차례" : "준비 중"}</i>
          </span>
          <b>{step.title || `${step.label} 고르기`}</b>
          <span className="memo">
            {ready ? `${game.name} · 후보 ${step.candidates.length}곳` : "아직 후보가 없어"}
          </span>
        </span>
        {ready && (
          <span className="go" aria-hidden="true">
            고르기 →
          </span>
        )}
      </button>
    </li>
  );
}
