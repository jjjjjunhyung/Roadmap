import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";

import { type Wish, errorMessage, wishApi } from "../lib/api";
import { haptic, sfx } from "../lib/feel";
import { formatDate, placeLine } from "../lib/look";
import { MapChip, Tile } from "./ui";

/**
 * Places we want to go: paste a Naver Map link (or the whole share text) and the name, kind,
 * neighbourhood and a photo come with it; other links or none need a name. A place shows
 * "다녀왔어" once a finished date picked it.
 */
export function Wishlist() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["wishes"], queryFn: wishApi.list, retry: false });
  const [link, setLink] = useState("");
  const [name, setName] = useState("");
  const [memo, setMemo] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const naver = /naver\.(me|com)/i.test(link);
  const needsName = !naver;
  const add = useMutation({
    mutationFn: () => wishApi.add(link, needsName ? name : "", memo),
    onSuccess: (w) => {
      qc.setQueryData<Wish[]>(["wishes"], (old) => [w, ...(old ?? [])]);
      setLink("");
      setName("");
      setMemo("");
      setNote(null);
      sfx.chime();
      haptic([10, 30, 16]);
    },
    onError: (e) => setNote(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: (id: string) => wishApi.remove(id),
    onSuccess: (_, id) =>
      qc.setQueryData<Wish[]>(["wishes"], (old) => (old ?? []).filter((w) => w.id !== id)),
    onError: (e) => setNote(errorMessage(e)),
  });

  const wishes = q.data ?? [];
  const ready = (link.trim() || name.trim()) && (!needsName || name.trim());

  return (
    <section className="wishes" aria-label="가고 싶은 곳">
      <form
        className="wish-add"
        onSubmit={(e) => {
          e.preventDefault();
          if (ready) add.mutate();
        }}
      >
        <input
          className="input"
          value={link}
          onChange={(e) => setLink(e.target.value)}
          placeholder="네이버 지도 링크를 붙여 넣어 줘"
          inputMode="url"
          aria-label="지도 링크"
        />
        {needsName && (
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={link.trim() ? "장소 이름" : "장소 이름 (링크 없이도 돼)"}
            maxLength={40}
            aria-label="장소 이름"
          />
        )}
        <input
          className="input"
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
          placeholder="한 줄 메모 (선택)"
          maxLength={80}
          aria-label="메모"
        />
        <button className="btn ink" disabled={!ready || add.isPending}>
          {add.isPending ? (naver ? "장소 찾는 중…" : "담는 중…") : "담기"}
        </button>
      </form>
      <p className="hint wish-hint">
        {note ?? "네이버 지도에서 공유 → 복사한 글을 그대로 붙여도 돼."}
      </p>

      {q.isPending ? null : wishes.length === 0 ? (
        <p className="wish-empty">아직 담아 둔 곳이 없어. 가 보고 싶은 곳을 담아 둬.</p>
      ) : (
        <ul className="wish-list">
          {wishes.map((w, i) => (
            <li key={w.id} className={`wish${w.visited ? " visited" : ""}`}>
              <Tile index={i} showIndex={false} image={w.image_url} />
              <span className="wish-body">
                <b>{w.name}</b>
                {placeLine(w) && <small>{placeLine(w)}</small>}
                {w.memo && <span className="wish-memo">{w.memo}</span>}
                <span className="wish-foot">
                  {w.visited && (
                    <Link
                      className="wish-done"
                      to="/p/$code"
                      params={{ code: w.visited.share_code }}
                    >
                      다녀왔어 · {formatDate(w.visited.date).md}
                    </Link>
                  )}
                  {w.map_url && <MapChip href={w.map_url} />}
                </span>
              </span>
              <button
                className="wish-x"
                aria-label={`${w.name} 지우기`}
                disabled={remove.isPending}
                onClick={() => {
                  if (confirm(`'${w.name}'을(를) 지울까?`)) remove.mutate(w.id);
                }}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
