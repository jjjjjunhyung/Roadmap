import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { type FocusEvent, useCallback, useMemo, useState } from "react";

import { Tile, Toast } from "../components/ui";
import { WeatherStrip } from "../components/Weather";
import { GAMES } from "../games";
import {
  type Candidate,
  type CandidateInput,
  type CourseFull,
  type GameId,
  type Kind,
  type PhotoOption,
  type Step,
  type StepInput,
  errorMessage,
  planApi,
  type PlannerWish,
} from "../lib/api";
import {
  type Form,
  KIND_GROUPS,
  KIND_LABEL,
  formOf,
  formatDate,
  placeLine,
  two,
} from "../lib/look";
import { shrink } from "../lib/photo";

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
  const wishes = useQuery({
    queryKey: ["plan", key, "wishes"],
    queryFn: api.wishes,
    retry: false,
  });
  const wishUsed = useCallback(
    () => void qc.invalidateQueries({ queryKey: ["plan", key, "wishes"] }),
    [qc, key],
  );
  // follows the date (and, through the cache's hour, the places)
  const wx = useQuery({
    queryKey: ["plan", key, "weather", courseId, q.data?.date],
    queryFn: () => api.weather(courseId),
    enabled: !!q.data,
    staleTime: 10 * 60_000,
    retry: 1,
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
  // her picks (the planner's fixed steps come back by themselves after a reset)
  const anyPicked = c.steps.some((s) => s.picked_by === "picker");
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
      <WeatherStrip
        report={wx.data}
        who="planner"
        outdoor={c.steps.some((s) => s.kind === "play" || s.kind === "walk")}
      />

      <section className="share" aria-label="공유">
        {c.status === "draft" ? (
          <>
            <p>
              <b>준비 중</b> · 아직 링크가 열리지 않았어. 단계마다 후보를 넣고 공유를 시작해 줘.
              후보가 하나면 정해 둔 곳으로 처음부터 보이고, 둘 이상이면 게임으로 골라.
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
                : "이 링크로 들어오면 하루 일정이 먼저 보이고, 안 정해진 곳만 원하는 순서로 골라."}
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
            wishes={wishes.data}
            onWishUsed={wishUsed}
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
  wishes: PlannerWish[] | undefined;
  onWishUsed: () => void;
}) {
  const { step, n, last, api, run, onMove, wishes, onWishUsed } = props;
  const save = (body: StepInput) => run(api.updateStep(step.id, body));
  const picked = step.candidates.find((c) => c.id === step.picked_id);
  const game = GAMES[step.game];
  // one candidate: the planner's decision, shown from the start with no game
  const fixed = step.candidates.length === 1;
  const form = formOf(step.kind);
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
            {KIND_GROUPS.map((g) => (
              <optgroup key={g.name} label={g.name}>
                {g.kinds.map((k) => (
                  <option key={k} value={k}>
                    {KIND_LABEL[k]}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
      </div>
      {form === "work" && (
        <div className="row2">
          <label className="field">
            <span>극장·공연장</span>
            <input
              key={step.venue_name}
              className="input"
              defaultValue={step.venue_name}
              maxLength={30}
              placeholder="예: CGV 용산"
              onBlur={onBlurSave(step.venue_name, (venue_name) => save({ venue_name }))}
            />
          </label>
          <label className="field">
            <span>지도 링크</span>
            <input
              className="input"
              defaultValue={step.venue_url}
              inputMode="url"
              placeholder="네이버지도 링크 (선택)"
              onBlur={onBlurSave(step.venue_url, (venue_url) => save({ venue_url }))}
            />
          </label>
        </div>
      )}
      <label className="field">
        <span>고르는 사람에게 보일 질문</span>
        <input
          className="input"
          defaultValue={step.title}
          maxLength={30}
          onBlur={onBlurSave(step.title, (title) => save({ title }))}
        />
      </label>
      {fixed ? (
        <p className="game-desc fixed-desc">
          <b>정해 둔 곳</b> · 후보가 하나라 게임 없이 처음부터 보여. 후보를 더 넣으면 게임으로 골라.
        </p>
      ) : (
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
      )}
      {!fixed && game && <p className="game-desc">{game.desc}</p>}
      {picked && (
        <p className="picked">
          {step.picked_by === "planner" ? "정해 둠" : "골랐어"} · {picked.name}
        </p>
      )}
      <ul className="cands">
        {step.candidates.map((c, i) => (
          <CandidateRow
            key={c.id}
            cand={c}
            form={form}
            index={i}
            chosen={c.id === step.picked_id}
            api={api}
            run={run}
          />
        ))}
      </ul>
      {step.candidates.length < 8 && (
        <>
          <AddCandidate stepId={step.id} form={form} api={api} run={run} />
          {form === "place" && (
            <WishPicker step={step} api={api} run={run} wishes={wishes} onUsed={onWishUsed} />
          )}
        </>
      )}
    </article>
  );
}

const NAME_LABEL: Record<Form, string> = { place: "장소 이름", work: "제목", free: "이름" };

function CandidateRow({
  cand,
  form,
  index,
  chosen,
  api,
  run,
}: {
  cand: Candidate;
  form: Form;
  index: number;
  chosen: boolean;
  api: Api;
  run: Run;
}) {
  const save = (body: CandidateInput) => run(api.updateCandidate(cand.id, body));
  const upload = async (f: File) => run(api.uploadImage(cand.id, await shrink(f, 1600)));
  const [picking, setPicking] = useState(false);
  return (
    <li className={`cand${chosen ? " chosen" : ""}`}>
      <button
        className="cand-photo"
        aria-expanded={picking}
        aria-label={`${cand.name} 사진 고르기`}
        onClick={() => setPicking(!picking)}
      >
        <Tile index={index} image={cand.image_url} />
        <span>사진</span>
      </button>
      <div className="fields">
        <input
          className="input name"
          defaultValue={cand.name}
          maxLength={30}
          aria-label={NAME_LABEL[form]}
          onBlur={onBlurSave(cand.name, (name) => save({ name }))}
        />
        {form === "work" && (
          <div className="work-times">
            <input
              className="input"
              type="time"
              defaultValue={cand.starts_at}
              aria-label="시작 시간"
              onBlur={onBlurSave(cand.starts_at, (starts_at) => save({ starts_at }))}
            />
            <span className="unit">
              <input
                className="input"
                type="number"
                inputMode="numeric"
                min={1}
                max={600}
                defaultValue={cand.runtime_min ?? ""}
                placeholder="러닝타임"
                aria-label="러닝타임(분)"
                onBlur={onBlurSave(String(cand.runtime_min ?? ""), (v) =>
                  save({ runtime_min: Number(v) || 0 }),
                )}
              />
              <i>분</i>
            </span>
          </div>
        )}
        <input
          className="input"
          defaultValue={cand.memo}
          maxLength={80}
          placeholder="메모 (선택)"
          aria-label="메모"
          onBlur={onBlurSave(cand.memo, (memo) => save({ memo }))}
        />
        {form === "place" && (
          <input
            className="input"
            defaultValue={cand.map_url}
            placeholder="지도 링크 (선택)"
            inputMode="url"
            aria-label="지도 링크"
            onBlur={onBlurSave(cand.map_url, (map_url) => save({ map_url }))}
          />
        )}
        {form === "work" && (
          <input
            className="input"
            defaultValue={cand.link_url}
            placeholder="정보·예매 링크 (선택)"
            inputMode="url"
            aria-label="정보·예매 링크"
            onBlur={onBlurSave(cand.link_url, (link_url) => save({ link_url }))}
          />
        )}
      </div>
      <button
        className="icon-btn"
        aria-label={`${cand.name} 삭제`}
        onClick={() => void run(api.removeCandidate(cand.id))}
      >
        <Icon d={TRASH} />
      </button>
      {picking && (
        <PhotoPicker
          cand={cand}
          form={form}
          api={api}
          save={save}
          upload={upload}
          onClose={() => setPicking(false)}
        />
      )}
    </li>
  );
}

/** Photos from the candidate's Naver Map link, plus "paste a link" and "no photo". */
function PhotoPicker(props: {
  cand: Candidate;
  form: Form;
  api: Api;
  save: (body: CandidateInput) => Promise<boolean>;
  upload: (f: File) => Promise<boolean>;
  onClose: () => void;
}) {
  const { cand, form, api, save, upload, onClose } = props;
  const naver = form === "place";
  const [sending, setSending] = useState(false);
  const q = useQuery({
    queryKey: ["photos", cand.id, cand.map_url],
    queryFn: () => api.photos(cand.id),
    staleTime: 10 * 60_000,
    enabled: naver,
  });
  const send = async (f: File | undefined) => {
    if (!f) return;
    setSending(true);
    const ok = await upload(f);
    setSending(false);
    if (ok) onClose();
  };
  const choose = async (image_url: string) => {
    if (await save({ image_url })) onClose();
  };
  const options: PhotoOption[] = (naver && q.data) || [];
  return (
    <div className="photo-pick">
      {!naver ? (
        <p className="hint">
          {form === "work"
            ? "포스터를 올리거나 포스터 사진 링크를 붙여 줘"
            : "사진을 올리거나 사진 링크를 붙여 줘"}
        </p>
      ) : q.isPending ? (
        <p className="hint">네이버 지도에서 사진을 찾는 중…</p>
      ) : q.isError ? (
        <p className="hint">{errorMessage(q.error)}</p>
      ) : options.length === 0 ? (
        <p className="hint">
          {cand.map_url
            ? "이 링크에서는 사진을 찾지 못했어. 아래에 사진 링크를 붙여 줘"
            : "네이버 지도 링크를 넣으면 사진을 찾아 줄게"}
        </p>
      ) : (
        <ul className="photo-grid">
          {options.map((o) => (
            <li key={o.url}>
              <button
                className={o.url === cand.image_url ? "on" : ""}
                aria-pressed={o.url === cand.image_url}
                onClick={() => void choose(o.url)}
              >
                <img src={o.url} alt="" loading="lazy" referrerPolicy="no-referrer" />
                <span>{o.label}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <input
        className="input"
        placeholder="다른 사진 링크 붙여넣기 (https://…)"
        inputMode="url"
        aria-label="사진 링크"
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
        onBlur={(e) => {
          const v = e.currentTarget.value.trim();
          if (v && v !== cand.image_url) void choose(v);
        }}
      />
      <div className="photo-actions">
        <label className={`btn small ink upload-btn${sending ? " busy" : ""}`}>
          {sending ? "올리는 중…" : form === "work" ? "포스터 올리기" : "사진 올리기"}
          <input
            type="file"
            accept="image/*"
            hidden
            disabled={sending}
            onChange={(e) => void send(e.currentTarget.files?.[0])}
          />
        </label>
        {cand.image_url && (
          <button className="btn small ghost" onClick={() => void choose("")}>
            사진 빼기
          </button>
        )}
        <button className="btn small ghost" onClick={onClose}>
          닫기
        </button>
      </div>
    </div>
  );
}

function AddCandidate(props: { stepId: string; form: Form; api: Api; run: Run }) {
  const { stepId, form, api, run } = props;
  const [name, setName] = useState("");
  const [memo, setMemo] = useState("");
  const [mapUrl, setMapUrl] = useState("");
  const [link, setLink] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [runtime, setRuntime] = useState("");
  const [busy, setBusy] = useState(false);
  const body: CandidateInput =
    form === "work"
      ? { name, memo, link_url: link, starts_at: startsAt, runtime_min: Number(runtime) || 0 }
      : form === "free"
        ? { name, memo }
        : { name, memo, map_url: mapUrl };
  // a work's page can give its title
  const ready = form === "work" ? !!(name.trim() || link.trim()) : !!name.trim();
  const working =
    form === "work" && link.trim()
      ? "제목·포스터 찾는 중…"
      : form === "place" && mapUrl.includes("naver")
        ? "사진 찾는 중…"
        : "추가하는 중…";
  return (
    <form
      className="add-cand"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        if (await run(api.addCandidate(stepId, body))) {
          setName("");
          setMemo("");
          setMapUrl("");
          setLink("");
          setStartsAt("");
          setRuntime("");
        }
        setBusy(false);
      }}
    >
      {form === "work" && (
        <input
          className="input"
          value={link}
          onChange={(e) => setLink(e.target.value)}
          placeholder="네이버 영화 검색·NOL 티켓 링크 (제목·포스터 자동)"
          inputMode="url"
          aria-label="정보·예매 링크"
        />
      )}
      <input
        className="input"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={
          form === "work"
            ? "제목 (링크가 있으면 비워도 돼)"
            : form === "free"
              ? "후보 이름 (예: 집에서 파스타 만들기)"
              : "후보 장소 이름"
        }
        maxLength={30}
        aria-label={NAME_LABEL[form]}
        required={form !== "work"}
      />
      {form === "work" && (
        <div className="work-times">
          <input
            className="input"
            type="time"
            value={startsAt}
            onChange={(e) => setStartsAt(e.target.value)}
            aria-label="시작 시간"
          />
          <span className="unit">
            <input
              className="input"
              type="number"
              inputMode="numeric"
              min={1}
              max={600}
              value={runtime}
              onChange={(e) => setRuntime(e.target.value)}
              placeholder="러닝타임"
              aria-label="러닝타임(분)"
            />
            <i>분</i>
          </span>
        </div>
      )}
      <input
        className="input"
        value={memo}
        onChange={(e) => setMemo(e.target.value)}
        placeholder="메모 (선택)"
        maxLength={80}
        aria-label="메모"
      />
      {form === "place" && (
        <input
          className="input"
          value={mapUrl}
          onChange={(e) => setMapUrl(e.target.value)}
          placeholder="카카오맵·네이버지도 링크 (선택)"
          inputMode="url"
          aria-label="지도 링크"
        />
      )}
      <button className="btn small ink" disabled={busy || !ready}>
        {busy ? working : "후보 추가"}
      </button>
    </form>
  );
}

/** Wishes from the archive, one tap away from being a candidate here. */
function WishPicker(props: {
  step: Step;
  api: Api;
  run: Run;
  wishes: PlannerWish[] | undefined;
  onUsed: () => void;
}) {
  const { step, api, run, wishes, onUsed } = props;
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  if (!wishes || wishes.length === 0) return null;
  const waiting = wishes.filter((w) => !w.visited).length;
  // already here: same link, or the same name when there is no link
  const inStep = (w: PlannerWish) =>
    step.candidates.some((c) => (w.map_url ? c.map_url === w.map_url : c.name === w.name));

  return (
    <div className="wish-pick">
      <button className="wish-pick-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? "위시리스트 닫기" : `위시리스트에서 가져오기 · ${waiting}곳`}
      </button>
      {open && (
        <ul>
          {wishes.map((w, i) => {
            const here = inStep(w);
            const where = w.visited
              ? `다녀옴 · ${formatDate(w.visited.date).md}`
              : w.used.length > 0
                ? `후보로 씀 · ${w.used.map((u) => `${formatDate(u.date).md} ${u.title}`).join(", ")}`
                : "";
            return (
              <li key={w.id} className={w.visited ? "visited" : ""}>
                <Tile index={i} showIndex={false} image={w.image_url} />
                <span className="wp-body">
                  <b>{w.name}</b>
                  {(placeLine(w) || w.memo) && (
                    <small>{[placeLine(w), w.memo].filter(Boolean).join(" · ")}</small>
                  )}
                  {where && <small className="wp-used">{where}</small>}
                </span>
                <button
                  className="btn small ink"
                  disabled={here || busy !== null}
                  onClick={async () => {
                    setBusy(w.id);
                    if (await run(api.fromWish(step.id, w.id))) onUsed();
                    setBusy(null);
                  }}
                >
                  {here ? "넣음" : busy === w.id ? "넣는 중…" : "넣기"}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
