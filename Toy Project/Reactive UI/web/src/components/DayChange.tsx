import { useState } from "react";

import {
  type Extra,
  type Kind,
  type PickView,
  type StepSummary,
  dayApi,
  errorMessage,
} from "../lib/api";
import { haptic, sfx } from "../lib/feel";
import { KIND_GROUPS, KIND_LABEL } from "../lib/look";

/**
 * Recording how a stop really went: somewhere else instead (a Naver Map link fills its name,
 * photo and location), or not at all. The planned place stays on the ticket, crossed out.
 */
export function DayChange(props: {
  code: string;
  step: StepSummary;
  onSaved: (v: PickView) => void;
  onClose: () => void;
}) {
  const { code, step, onSaved, onClose } = props;
  const a = step.actual;
  const [skipped, setSkipped] = useState(a?.skipped ?? false);
  const [name, setName] = useState(a && !a.skipped ? a.name : "");
  const [mapUrl, setMapUrl] = useState(a?.map_url ?? "");
  const [memo, setMemo] = useState(a?.memo ?? "");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const send = async (p: Promise<PickView>) => {
    setBusy(true);
    setNote(null);
    try {
      const v = await p;
      sfx.pop();
      haptic(12);
      onSaved(v);
    } catch (e) {
      setNote(errorMessage(e));
      setBusy(false);
    }
  };
  const ready = skipped || !!(name.trim() || mapUrl.trim());

  return (
    <div className="scrim" role="dialog" aria-modal="true" aria-labelledby="dc-title">
      <form
        className="sheet day-change"
        onSubmit={(e) => {
          e.preventDefault();
          void send(
            dayApi.set(
              code,
              step.id,
              skipped ? { skipped: true, memo } : { name, map_url: mapUrl, memo },
            ),
          );
        }}
      >
        <span className="label">{step.label} · 당일에 바뀐 곳</span>
        <h3 id="dc-title">
          <s>{step.picked?.name}</s>
        </h3>
        <div className="dc-pick" role="group" aria-label="어떻게 바뀌었는지">
          <button type="button" aria-pressed={!skipped} onClick={() => setSkipped(false)}>
            다른 곳에 갔어
          </button>
          <button type="button" aria-pressed={skipped} onClick={() => setSkipped(true)}>
            안 갔어
          </button>
        </div>
        {!skipped && (
          <>
            <input
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="대신 간 곳 (링크가 있으면 비워도 돼)"
              maxLength={30}
              aria-label="대신 간 곳"
            />
            <input
              className="input"
              value={mapUrl}
              onChange={(e) => setMapUrl(e.target.value)}
              placeholder="네이버 지도 링크 (붙이면 사진·위치 자동)"
              inputMode="url"
              aria-label="지도 링크"
            />
          </>
        )}
        <input
          className="input"
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
          placeholder={skipped ? "왜 안 갔는지 한 줄 (선택)" : "한 줄 메모 (선택)"}
          maxLength={80}
          aria-label="메모"
        />
        {note && <p className="dc-note">{note}</p>}
        <div className="actions">
          {a && (
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => void send(dayApi.clear(code, step.id))}
            >
              원래대로
            </button>
          )}
          <button type="button" className="btn" onClick={onClose}>
            닫기
          </button>
          <button className="btn accent" disabled={busy || !ready}>
            {busy ? "저장하는 중…" : "저장"}
          </button>
        </div>
      </form>
    </div>
  );
}

/**
 * A place they dropped by that was never in the plan: after which stop, when, what kind, and
 * where (a Naver Map link fills its name, photo and location). Editing one can also remove it.
 */
export function ExtraSheet(props: {
  code: string;
  steps: StepSummary[];
  /** null: a new one */
  extra: Extra | null;
  onSaved: (v: PickView) => void;
  onClose: () => void;
}) {
  const { code, steps, extra, onSaved, onClose } = props;
  const decided = steps.filter((s) => s.picked);
  const [after, setAfter] = useState(
    extra ? (extra.after_step_id ?? "") : (decided.at(-1)?.id ?? ""),
  );
  const [time, setTime] = useState(extra?.time ?? "");
  // until "어디 다음에" is chosen by hand, the time picks it: the last stop that began earlier
  const [afterChosen, setAfterChosen] = useState(!!extra);
  const pickTime = (t: string) => {
    setTime(t);
    if (afterChosen || !t) return;
    const before = decided.filter((s) => s.time && s.time <= t);
    setAfter(before.at(-1)?.id ?? decided[0]?.id ?? "");
  };
  const [kind, setKind] = useState<Kind>(extra?.kind ?? "play");
  const [name, setName] = useState(extra?.name ?? "");
  const [mapUrl, setMapUrl] = useState(extra?.map_url ?? "");
  const [memo, setMemo] = useState(extra?.memo ?? "");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const send = async (p: Promise<PickView>) => {
    setBusy(true);
    setNote(null);
    try {
      const v = await p;
      sfx.pop();
      haptic(12);
      onSaved(v);
    } catch (e) {
      setNote(errorMessage(e));
      setBusy(false);
    }
  };
  const body = { after_step_id: after || null, time, kind, name, map_url: mapUrl, memo };

  return (
    <div className="scrim" role="dialog" aria-modal="true" aria-labelledby="ex-title">
      <form
        className="sheet day-change"
        onSubmit={(e) => {
          e.preventDefault();
          void send(extra ? dayApi.editExtra(code, extra.id, body) : dayApi.addExtra(code, body));
        }}
      >
        <span className="label">당일에 더 들른 곳</span>
        <h3 id="ex-title">{extra ? extra.name : "즉흥으로 들른 곳"}</h3>
        <label className="dc-field">
          <span>어디 다음에</span>
          <select
            className="select"
            value={after}
            onChange={(e) => {
              setAfterChosen(true);
              setAfter(e.target.value);
            }}
          >
            {decided.map((s) => (
              <option key={s.id} value={s.id}>
                {[s.time, s.label, s.actual && !s.actual.skipped ? s.actual.name : s.picked?.name]
                  .filter(Boolean)
                  .join(" · ")}{" "}
                다음
              </option>
            ))}
            <option value="">맨 끝</option>
          </select>
        </label>
        <div className="dc-row">
          <label className="dc-field">
            <span>시간</span>
            <input
              className="input"
              type="time"
              value={time}
              onChange={(e) => pickTime(e.target.value)}
            />
          </label>
          <label className="dc-field">
            <span>아이콘</span>
            <select
              className="select"
              value={kind}
              onChange={(e) => setKind(e.target.value as Kind)}
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
        <input
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="들른 곳 (링크가 있으면 비워도 돼)"
          maxLength={30}
          aria-label="들른 곳"
        />
        <input
          className="input"
          value={mapUrl}
          onChange={(e) => setMapUrl(e.target.value)}
          placeholder="네이버 지도 링크 (붙이면 사진·위치 자동)"
          inputMode="url"
          aria-label="지도 링크"
        />
        <input
          className="input"
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
          placeholder="한 줄 메모 (선택)"
          maxLength={80}
          aria-label="메모"
        />
        {note && <p className="dc-note">{note}</p>}
        <div className="actions">
          {extra && (
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => void send(dayApi.removeExtra(code, extra.id))}
            >
              지우기
            </button>
          )}
          <button type="button" className="btn" onClick={onClose}>
            닫기
          </button>
          <button className="btn accent" disabled={busy || !(name.trim() || mapUrl.trim())}>
            {busy ? "저장하는 중…" : "저장"}
          </button>
        </div>
      </form>
    </div>
  );
}
