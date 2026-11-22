import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { type PersonView, errorMessage, type planApi } from "../lib/api";

/** "11.22" for a unix time. */
function day(unix: number) {
  const d = new Date(unix * 1000);
  return `${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
}

/** "iPhone · Safari" from a User-Agent, enough to recognise a device. */
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
 * Who may open the archive: each person's registered devices, sign-outs, and single-use
 * registration links (shown once, valid a day).
 */
export function PeopleCard({
  api,
  plannerKey,
}: {
  api: ReturnType<typeof planApi>;
  plannerKey: string;
}) {
  const qc = useQueryClient();
  const queryKey = ["plan", plannerKey, "people"];
  const q = useQuery({ queryKey, queryFn: api.people, retry: false });
  const [name, setName] = useState("");
  const [link, setLink] = useState<{ url: string; name: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const save = (people: PersonView[]) => qc.setQueryData(queryKey, people);
  const act = useMutation({
    mutationFn: (f: () => Promise<PersonView[]>) => f(),
    onSuccess: save,
  });
  const invite = useMutation({
    mutationFn: (who: string) => api.invite(who),
    onSuccess: (r, who) => {
      save(r.people);
      setLink({ url: `${location.origin}/join/${r.token}`, name: who });
      setCopied(false);
      setName("");
    },
  });

  if (q.isError) return null;
  const people = q.data ?? [];
  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(true);
    } catch {
      /* the link is on screen to copy by hand */
    }
  };

  return (
    <section className="stage people" aria-label="들어오는 사람">
      <span className="label">Archive access</span>
      <div className="people-card">
        {people.length === 0 && (
          <p className="people-empty">
            아직 등록된 사람이 없어. 이름을 적고 등록 링크를 만들어서 보내 줘.
          </p>
        )}
        {people.map((p) => (
          <div key={p.id} className="person">
            <div className="person-head">
              <b>{p.name}</b>
              <span className="person-meta">
                기기 {p.devices.length} · 로그인 {p.sessions}
                {p.open_invites > 0 && ` · 링크 ${p.open_invites}`}
              </span>
              <span className="person-acts">
                <button
                  className="btn small ghost"
                  disabled={act.isPending || p.sessions === 0}
                  onClick={() => act.mutate(() => api.signOut(p.id))}
                >
                  모두 로그아웃
                </button>
                <button
                  className="btn small ghost"
                  disabled={act.isPending}
                  onClick={() => {
                    if (confirm(`${p.name}의 기기와 로그인을 모두 지울까?`))
                      act.mutate(() => api.removePerson(p.id));
                  }}
                >
                  지우기
                </button>
              </span>
            </div>
            {p.devices.length > 0 && (
              <ul className="devices">
                {p.devices.map((d) => (
                  <li key={d.id}>
                    <span className="who">
                      {device(d.agent)}
                      <small>
                        등록 {day(d.created_at)} · 최근 {day(d.used_at)}
                      </small>
                    </span>
                    <button
                      className="btn small ghost"
                      disabled={act.isPending}
                      onClick={() => {
                        if (confirm("이 기기 등록을 지울까? 이 기기로 열린 로그인도 끝나."))
                          act.mutate(() => api.removeDevice(d.id));
                      }}
                    >
                      삭제
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <button
              className="person-more"
              disabled={invite.isPending}
              onClick={() => invite.mutate(p.name)}
            >
              + {p.name}의 다른 기기 등록 링크
            </button>
          </div>
        ))}

        <form
          className="invite-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) invite.mutate(name.trim());
          }}
        >
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="새 사람 이름"
            maxLength={20}
            aria-label="새 사람 이름"
          />
          <button className="btn ink small" disabled={invite.isPending || !name.trim()}>
            등록 링크 만들기
          </button>
        </form>
        {(invite.isError || act.isError) && (
          <p className="people-err">{errorMessage(invite.error ?? act.error)}</p>
        )}

        {link && (
          <div className="invite-made">
            <p>
              <b>{link.name}</b>의 등록 링크야. 24시간 동안 한 번만 쓸 수 있고, 지금만 보여.
              카톡으로 보내고 Safari나 Chrome에서 열라고 해 줘.
            </p>
            <div className="link">
              <code>{link.url}</code>
              <button className="btn small ink" type="button" onClick={() => void copy()}>
                {copied ? "복사됨" : "복사"}
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
