import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { type ClientConfig, type Theme, errorMessage, type planApi } from "../lib/api";
import { useConfig } from "../lib/config";

const CHOICES: { id: Theme; name: string; desc: string }[] = [
  { id: "plain", name: "기본", desc: "늘 쓰던 밝은 화면" },
  { id: "holiday", name: "연말", desc: "겨울밤 · 눈 · 꼬마전구" },
];

/**
 * The planner's switch for how every page behind the birthday looks: the archive (past dates and
 * the wishlist) and each shared course. The lock itself keeps its usual look.
 */
export function ThemeCard({ api }: { api: ReturnType<typeof planApi> }) {
  const qc = useQueryClient();
  const cfg = useConfig();
  const [note, setNote] = useState<string | null>(null);
  const set = useMutation({
    mutationFn: (theme: Theme) => api.setTheme(theme),
    onSuccess: ({ theme }) => {
      setNote(null);
      qc.setQueryData<ClientConfig>(["config"], (c) => (c ? { ...c, theme } : c));
    },
    onError: (e) => setNote(errorMessage(e)),
  });
  const theme = set.isPending ? set.variables : (cfg.data?.theme ?? "plain");

  return (
    <section className="stage guard" aria-label="화면 테마">
      <span className="label">Theme</span>
      <div className="guard-card">
        <div className="guard-head">
          <b>{theme === "holiday" ? "연말 테마" : "기본 테마"}</b>
          <span className="guard-meta">생일로 들어온 뒤 화면 전체</span>
        </div>
        <p className="theme-desc">
          지난 데이트, 가고 싶은 곳, 공유한 데이트 화면이 모두 이 테마로 보여. 생일 입력 화면은
          그대로야.
        </p>
        <div className="theme-pick" role="group" aria-label="테마">
          {CHOICES.map((c) => (
            <button
              key={c.id}
              type="button"
              aria-pressed={theme === c.id}
              disabled={set.isPending}
              onClick={() => theme !== c.id && set.mutate(c.id)}
            >
              <b>{c.name}</b>
              <span>{c.desc}</span>
            </button>
          ))}
        </div>
        {note && <p className="guard-err">{note}</p>}
      </div>
    </section>
  );
}
