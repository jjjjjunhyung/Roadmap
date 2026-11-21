import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { type FocusEvent, useCallback, useMemo, useState } from "react";

import { Tile, Toast } from "../components/ui";
import { GAMES } from "../games";
import {
  type Candidate,
  type CandidateInput,
  type CourseFull,
  type GameId,
  type Kind,
  type Step,
  type StepInput,
  errorMessage,
  planApi,
} from "../lib/api";
import { KIND_LABEL, formatDate, two } from "../lib/look";

export const Route = createFileRoute("/plan/$key/$courseId")({ component: Editor });

type Api = ReturnType<typeof planApi>;
type Run = (p: Promise<CourseFull>) => Promise<boolean>;

const Icon = ({ d }: { d: string }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.5}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d={d} />
  </svg>
);
const UP = "M12 19V5M6 11l6-6 6 6";
const DOWN = "M12 5v14M6 13l6 6 6-6";
const TRASH = "M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13";

/** Saves an uncontrolled input on blur when its value changed; restores it if the save fails. */
function onBlurSave(current: string, save: (v: string) => Promise<boolean>) {
  return async (e: FocusEvent<HTMLInputElement>) => {
    const input = e.currentTarget;
    if (input.value.trim() === current) return;
    if (!(await save(input.value))) input.value = current;
  };
}

function Editor() {
  const { key, courseId } = Route.useParams();
  const api = useMemo(() => planApi(key), [key]);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const q = useQuery({
    queryKey: ["plan", key, "course", courseId],
    queryFn: () => api.course(courseId),
    retry: false,
  });
  const [toast, setToast] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const clearToast = useCallback(() => setToast(null), []);

  const run: Run = useCallback(
    async (p) => {
      try {
        qc.setQueryData(["plan", key, "course", courseId], await p);
        void qc.invalidateQueries({ queryKey: ["plan", key, "courses"] });
        return true;
      } catch (e) {
        setToast(errorMessage(e));
        return false;
      }
    },
    [qc, key, courseId],
  );

  if (q.isPending)
    return (
      <main className="page">
        <p className="empty">불러오는 중…</p>
      </main>
    );
  if (q.isError) {
    return (
      <main className="page">
        <div className="message">
          <h2>데이트를 열 수 없어</h2>
          <p>{errorMessage(q.error)}</p>
        </div>
      </main>
    );
  }

  const c = q.data;
  const d = formatDate(c.date);
  const shareUrl = `${location.origin}/p/${c.share_code}`;
  const anyPicked = c.steps.some((s) => s.picked_id);
  const move = (i: number, dir: -1 | 1) => {
    const ids = c.steps.map((s) => s.id);
    [ids[i], ids[i + dir]] = [ids[i + dir], ids[i]];
    void run(api.order(c.id, ids));
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setToast("복사하지 못했어. 주소를 길게 눌러 복사해 줘");
    }
  };

  return (
    <main className="page">
      <header className="plan-head">
        <Link className="back" to="/plan/$key" params={{ key }}>
          ← 데이트 목록
        </Link>
        <p className="date" aria-label={d.full}>
          {d.md}
          <small>{d.dow}</small>
        </p>
        <input
          className="input title"
          defaultValue={c.title}
          maxLength={40}
          aria-label="데이트 제목"
          onBlur={onBlurSave(c.title, (title) => run(api.update(c.id, { title })))}
        />
        <label className="field">
          <span>날짜</span>
          <input
            className="input"
            type="date"
            defaultValue={c.date}
            onChange={(e) =>
              e.target.value &&
              e.target.value !== c.date &&
              void run(api.update(c.id, { date: e.target.value }))
            }
          />
        </label>
      </header>

      <section className="share" aria-label="공유">
        {c.status === "draft" ? (
          <>
            <p>
              <b>준비 중</b> · 아직 링크가 열리지 않았어. 단계마다 후보를 두 개 이상 넣고 공유를
              시작해 줘.
            </p>
            <div className="btns">
              <button
                className="btn accent small"
                onClick={() => void run(api.update(c.id, { status: "open" }))}
              >
                공유 시작
              </button>
            </div>
          </>
        ) : (
          <>
            <p>
              <b>{c.status === "done" ? "완성" : "공유 중"}</b> ·{" "}
              {c.status === "done"
                ? "모든 단계를 골랐어."
                : "이 링크로 들어오면 단계마다 하나씩 고를 수 있어."}
            </p>
            <div className="link">
              <code>{shareUrl}</code>
              <button className="btn small ink" onClick={() => void copy()}>
                {copied ? "복사됨" : "복사"}
              </button>
            </div>
            <div className="btns">
              <a
                className="btn small ghost"
                href={shareUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                열어 보기
              </a>
              <button
                className="btn small ghost"
                onClick={() => void run(api.update(c.id, { status: "draft" }))}
              >
                공유 멈추기
              </button>
              {anyPicked && (
                <button
                  className="btn small ghost"
                  onClick={() =>
                    window.confirm("고른 결과를 모두 지울까?") && void run(api.reset(c.id))
                  }
                >
                  선택 초기화
                </button>
              )}
            </div>
          </>
        )}
      </section>

      <section className="psteps" aria-label="단계">
        {c.steps.map((s, i) => (
          <StepEditor
            key={s.id}
            step={s}
            n={i}
            last={i === c.steps.length - 1}
            api={api}
            run={run}
            onMove={move}
          />
        ))}
      </section>

      <button
        className="btn ghost"
        onClick={() => void run(api.addStep(c.id, { label: "새 단계" }))}
      >
        + 단계 추가
      </button>
      <button
        className="btn"
        onClick={async () => {
          if (!window.confirm(`'${c.title}' 데이트를 삭제할까?`)) return;
          try {
            await api.remove(c.id);
            void qc.invalidateQueries({ queryKey: ["plan", key, "courses"] });
            void navigate({ to: "/plan/$key", params: { key } });
          } catch (e) {
            setToast(errorMessage(e));
          }
        }}
      >
        이 데이트 삭제
      </button>
      <Toast message={toast} onDone={clearToast} />
    </main>
  );
}

function StepEditor(props: {
  step: Step;
  n: number;
  last: boolean;
  api: Api;
  run: Run;
  onMove: (i: number, dir: -1 | 1) => void;
}) {
  const { step, n, last, api, run, onMove } = props;
  const save = (body: StepInput) => run(api.updateStep(step.id, body));
  const picked = step.candidates.find((c) => c.id === step.picked_id);
  const game = GAMES[step.game];
  return (
    <article className="pstep">
      <div className="pstep-head">
        <span className="no">{two(n)}</span>
        <div className="tools">
          <button
            className="icon-btn"
            disabled={n === 0}
            aria-label="위로"
            onClick={() => onMove(n, -1)}
          >
            <Icon d={UP} />
          </button>
          <button
            className="icon-btn"
            disabled={last}
            aria-label="아래로"
            onClick={() => onMove(n, 1)}
          >
            <Icon d={DOWN} />
          </button>
          <button
            className="icon-btn"
            aria-label="단계 삭제"
            onClick={() =>
              window.confirm(`'${step.label}' 단계를 지울까?`) && void run(api.removeStep(step.id))
            }
          >
            <Icon d={TRASH} />
          </button>
        </div>
      </div>
      <div className="row3">
        <label className="field">
          <span>이름</span>
          <input
            className="input"
            defaultValue={step.label}
            maxLength={12}
            onBlur={onBlurSave(step.label, (label) => save({ label }))}
          />
        </label>
        <label className="field">
          <span>시간</span>
          <input
            className="input"
            type="time"
            defaultValue={step.time}
            onBlur={onBlurSave(step.time, (time) => save({ time }))}
          />
        </label>
        <label className="field">
          <span>아이콘</span>
          <select
            className="select"
            value={step.kind}
            onChange={(e) => void save({ kind: e.target.value as Kind })}
          >
            {Object.entries(KIND_LABEL).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="field">
        <span>고르는 사람에게 보일 질문</span>
        <input
          className="input"
          defaultValue={step.title}
          maxLength={30}
          onBlur={onBlurSave(step.title, (title) => save({ title }))}
        />
      </label>
      <div className="row2">
        <label className="field">
          <span>고르는 게임</span>
          <select
            className="select"
            value={step.game}
            onChange={(e) => void save({ game: e.target.value as GameId })}
          >
            {Object.entries(GAMES).map(([id, g]) => (
              <option key={id} value={id}>
                {g.name}
              </option>
            ))}
          </select>
        </label>
        {game?.luck ? (
          <label className="field">
            <span>다시 하기</span>
            <select
              className="select"
              value={step.rerolls}
              onChange={(e) => void save({ rerolls: Number(e.target.value) })}
            >
              {[0, 1, 2, 3].map((r) => (
                <option key={r} value={r}>
                  {r}번
                </option>
              ))}
            </select>
          </label>
        ) : (
          <span />
        )}
      </div>
      {game && <p className="game-desc">{game.desc}</p>}
      {picked && <p className="picked">골랐어 · {picked.name}</p>}
      <ul className="cands">
        {step.candidates.map((c, i) => (
          <CandidateRow
            key={c.id}
            cand={c}
            index={i}
            chosen={c.id === step.picked_id}
            api={api}
            run={run}
          />
        ))}
      </ul>
      {step.candidates.length < 8 && <AddCandidate stepId={step.id} api={api} run={run} />}
    </article>
  );
}

function CandidateRow({
  cand,
  index,
  chosen,
  api,
  run,
}: {
  cand: Candidate;
  index: number;
  chosen: boolean;
  api: Api;
  run: Run;
}) {
  const save = (body: CandidateInput) => run(api.updateCandidate(cand.id, body));
  return (
    <li className={`cand${chosen ? " chosen" : ""}`}>
      <Tile index={index} />
      <div className="fields">
        <input
          className="input name"
          defaultValue={cand.name}
          maxLength={30}
          aria-label="장소 이름"
          onBlur={onBlurSave(cand.name, (name) => save({ name }))}
        />
        <input
          className="input"
          defaultValue={cand.memo}
          maxLength={80}
          placeholder="메모 (선택)"
          aria-label="메모"
          onBlur={onBlurSave(cand.memo, (memo) => save({ memo }))}
        />
        <input
          className="input"
          defaultValue={cand.map_url}
          placeholder="지도 링크 (선택)"
          inputMode="url"
          aria-label="지도 링크"
          onBlur={onBlurSave(cand.map_url, (map_url) => save({ map_url }))}
        />
      </div>
      <button
        className="icon-btn"
        aria-label={`${cand.name} 삭제`}
        onClick={() => void run(api.removeCandidate(cand.id))}
      >
        <Icon d={TRASH} />
      </button>
    </li>
  );
}

function AddCandidate({ stepId, api, run }: { stepId: string; api: Api; run: Run }) {
  const [name, setName] = useState("");
  const [memo, setMemo] = useState("");
  const [mapUrl, setMapUrl] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="add-cand"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        if (await run(api.addCandidate(stepId, { name, memo, map_url: mapUrl }))) {
          setName("");
          setMemo("");
          setMapUrl("");
        }
        setBusy(false);
      }}
    >
      <input
        className="input"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="후보 장소 이름"
        maxLength={30}
        aria-label="후보 장소 이름"
        required
      />
      <input
        className="input"
        value={memo}
        onChange={(e) => setMemo(e.target.value)}
        placeholder="메모 (선택)"
        maxLength={80}
        aria-label="메모"
      />
      <input
        className="input"
        value={mapUrl}
        onChange={(e) => setMapUrl(e.target.value)}
        placeholder="카카오맵·네이버지도 링크 (선택)"
        inputMode="url"
        aria-label="지도 링크"
      />
      <button className="btn small ink" disabled={busy || !name.trim()}>
        후보 추가
      </button>
    </form>
  );
}
