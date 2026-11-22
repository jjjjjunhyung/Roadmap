import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { type PointerEvent, useEffect, useRef, useState } from "react";

import {
  type AlbumPhoto,
  ApiError,
  type StepSummary,
  albumApi,
  errorMessage,
  photoUrl,
} from "../lib/api";
import { haptic, sfx } from "../lib/feel";
import { shrink } from "../lib/photo";

/** "all", "day" (photos of no stop) or a step id */
type Tab = string;

/**
 * "우리 사진" under a finished course: everyone signed in with the birthday can add photos of
 * the day (to a stop, or to the day in general), browse them by stop and open them full screen.
 * Without the birthday it only says where to sign in; share links alone never show photos.
 */
export function Album({ code, steps }: { code: string; steps: StepSummary[] }) {
  const qc = useQueryClient();
  const queryKey = ["album", code];
  const q = useQuery({ queryKey, queryFn: () => albumApi.list(code), retry: false });
  const [tab, setTab] = useState<Tab>("all");
  const [sending, setSending] = useState<{ done: number; total: number } | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const file = useRef<HTMLInputElement>(null);

  if (q.isPending) return null;
  if (q.isError) {
    if (!(q.error instanceof ApiError && q.error.status === 401)) return null;
    return (
      <section className="album album-locked" aria-label="우리 사진">
        <span className="label">Album</span>
        <p>그날 사진은 생일로 들어와야 볼 수 있어.</p>
        <Link className="btn small ghost" to="/">
          생일로 들어가기
        </Link>
      </section>
    );
  }

  const photos = q.data;
  const stops = steps.filter((s) => s.picked);
  const loose = photos.filter((p) => !p.step_id || !stops.some((s) => s.id === p.step_id));
  const tabs = [
    { id: "all", label: "전체", time: "", n: photos.length },
    ...stops.map((s) => ({
      id: s.id,
      label: s.picked?.name ?? s.label,
      time: s.time,
      n: photos.filter((p) => p.step_id === s.id).length,
    })),
    ...(loose.length ? [{ id: "day", label: "그 밖에", time: "", n: loose.length }] : []),
  ];
  const shown =
    tab === "all" ? photos : tab === "day" ? loose : photos.filter((p) => p.step_id === tab);
  const target = tab === "all" || tab === "day" ? null : tab;
  const targetName = stops.find((s) => s.id === target)?.picked?.name;

  const add = async (files: File[]) => {
    if (!files.length) return;
    setNote(null);
    setSending({ done: 0, total: files.length });
    let failed = 0;
    for (const [i, f] of files.entries()) {
      try {
        const photo = await albumApi.upload(code, await shrink(f), target);
        qc.setQueryData<AlbumPhoto[]>(queryKey, (old) => [...(old ?? []), photo]);
      } catch (e) {
        failed++;
        setNote(errorMessage(e));
      }
      setSending({ done: i + 1, total: files.length });
    }
    setSending(null);
    if (file.current) file.current.value = "";
    if (!failed) {
      sfx.chime();
      haptic([10, 30, 16]);
    }
  };

  const remove = async (p: AlbumPhoto) => {
    if (!confirm("이 사진을 지울까? 지우면 되돌릴 수 없어.")) return;
    try {
      await albumApi.remove(p.id);
      const rest = shown.filter((x) => x.id !== p.id);
      qc.setQueryData<AlbumPhoto[]>(queryKey, (old) => (old ?? []).filter((x) => x.id !== p.id));
      setOpen((i) => (i === null || rest.length === 0 ? null : Math.min(i, rest.length - 1)));
    } catch (e) {
      setNote(errorMessage(e));
    }
  };

  return (
    <section className="album" aria-label="우리 사진">
      <div className="album-head">
        <span className="label">Album · {photos.length}장</span>
        <button
          className="btn small ink"
          disabled={sending !== null}
          onClick={() => file.current?.click()}
        >
          {sending ? `${sending.done}/${sending.total} 올리는 중…` : "+ 사진 올리기"}
        </button>
        <input
          ref={file}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => void add([...(e.target.files ?? [])])}
        />
      </div>

      {tabs.length > 1 && (
        <div className="album-tabs" role="tablist" aria-label="장소별 사진">
          {tabs.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              className={tab === t.id ? "on" : ""}
              onClick={() => setTab(t.id)}
            >
              {t.time && <small>{t.time}</small>}
              <span>{t.label}</span>
              <i>{t.n}</i>
            </button>
          ))}
        </div>
      )}

      {shown.length === 0 ? (
        <p className="album-empty">
          {photos.length === 0
            ? "아직 사진이 없어. 그날 찍은 사진을 올려 줘."
            : "이 장소 사진은 아직 없어."}
        </p>
      ) : (
        <ul className="album-grid">
          {shown.map((p, i) => (
            <li key={p.id}>
              <button onClick={() => setOpen(i)} aria-label={`사진 ${i + 1} 크게 보기`}>
                <img src={photoUrl(p.id, true)} alt="" loading="lazy" decoding="async" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="album-hint">
        {targetName
          ? `지금 올리는 사진은 '${targetName}'에 들어가.`
          : "장소 탭을 고르고 올리면 그 장소 사진으로 들어가."}
      </p>
      {note && <p className="album-note">{note}</p>}

      {open !== null && shown[open] && (
        <Viewer
          photos={shown}
          index={open}
          stopName={(p) => stops.find((s) => s.id === p.step_id)?.picked?.name ?? "그날"}
          onIndex={setOpen}
          onClose={() => setOpen(null)}
          onDelete={(p) => void remove(p)}
        />
      )}
    </section>
  );
}

/** Full screen: swipe or arrows to move, Esc or ✕ to close. */
function Viewer(props: {
  photos: AlbumPhoto[];
  index: number;
  stopName: (p: AlbumPhoto) => string;
  onIndex: (i: number) => void;
  onClose: () => void;
  onDelete: (p: AlbumPhoto) => void;
}) {
  const { photos, index, stopName, onIndex, onClose, onDelete } = props;
  const p = photos[index];
  const swipe = useRef<{ x: number; id: number } | null>(null);
  const [loaded, setLoaded] = useState<string | null>(null);
  const go = (d: number) => {
    const n = index + d;
    if (n < 0 || n >= photos.length) return;
    sfx.tick();
    onIndex(n);
  };

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft" && index > 0) onIndex(index - 1);
      if (e.key === "ArrowRight" && index < photos.length - 1) onIndex(index + 1);
    };
    window.addEventListener("keydown", key);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", key);
      document.body.style.overflow = overflow;
    };
  }, [index, photos.length, onIndex, onClose]);

  const down = (e: PointerEvent) => {
    swipe.current = { x: e.clientX, id: e.pointerId };
  };
  const up = (e: PointerEvent) => {
    const s = swipe.current;
    swipe.current = null;
    if (!s || s.id !== e.pointerId) return;
    const dx = e.clientX - s.x;
    if (Math.abs(dx) > 48) go(dx < 0 ? 1 : -1);
  };

  return (
    <div className="viewer" role="dialog" aria-modal="true" aria-label="사진 보기">
      <div className="viewer-bar">
        <span>
          {index + 1} / {photos.length} · {stopName(p)}
        </span>
        <button className="viewer-x" onClick={onClose} aria-label="닫기">
          ✕
        </button>
      </div>
      <div className="viewer-stage" onPointerDown={down} onPointerUp={up}>
        <img className="viewer-thumb" src={photoUrl(p.id, true)} alt="" aria-hidden="true" />
        <img
          key={p.id}
          className={`viewer-img${loaded === p.id ? " in" : ""}`}
          src={photoUrl(p.id)}
          alt={`${stopName(p)} 사진`}
          onLoad={() => setLoaded(p.id)}
          draggable={false}
        />
        {index > 0 && (
          <button className="viewer-nav prev" onClick={() => go(-1)} aria-label="이전 사진">
            ‹
          </button>
        )}
        {index < photos.length - 1 && (
          <button className="viewer-nav next" onClick={() => go(1)} aria-label="다음 사진">
            ›
          </button>
        )}
      </div>
      <div className="viewer-foot">
        <button className="btn small ghost" onClick={() => onDelete(p)}>
          이 사진 지우기
        </button>
      </div>
    </div>
  );
}
