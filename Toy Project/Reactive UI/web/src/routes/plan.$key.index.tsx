import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useMemo, useState } from "react";

import { BackupCard } from "../components/Backup";
import { GuardCard } from "../components/Guard";
import { ThemeCard } from "../components/ThemeCard";
import { Toast } from "../components/ui";
import { errorMessage, planApi } from "../lib/api";
import { formatDate } from "../lib/look";

export const Route = createFileRoute("/plan/$key/")({ component: CourseList });

const STATUS = { draft: "준비 중", open: "공유 중", done: "완성" } as const;

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function CourseList() {
  const { key } = Route.useParams();
  const api = useMemo(() => planApi(key), [key]);
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ["plan", key, "courses"], queryFn: api.list, retry: false });
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(today);
  const [toast, setToast] = useState<string | null>(null);
  const clearToast = useCallback(() => setToast(null), []);
  const create = useMutation({
    mutationFn: () => api.create(title, date),
    onSuccess: (c) => navigate({ to: "/plan/$key/$courseId", params: { key, courseId: c.id } }),
    onError: (e) => setToast(errorMessage(e)),
  });

  if (q.isError) {
    return (
      <main className="page">
        <div className="message">
          <h2>들어올 수 없어</h2>
          <p>{errorMessage(q.error)}</p>
        </div>
      </main>
    );
  }

  return (
    <main className="page">
      <header className="plan-head">
        <span className="label">Planner</span>
        <h2>데이트 준비</h2>
        <p className="lede">
          날짜를 정하고 단계마다 후보를 넣어 줘. 후보가 하나면 정해 둔 곳, 여러 개면 링크를 받은
          상대가 게임으로 골라.
        </p>
      </header>

      <form
        className="new-course"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        <label className="field">
          <span>제목</span>
          <input
            className="input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="크리스마스 데이트"
            maxLength={40}
            required
          />
        </label>
        <label className="field">
          <span>날짜</span>
          <input
            className="input"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            required
          />
        </label>
        <button className="btn ink" disabled={create.isPending || !title.trim()}>
          새 데이트 만들기
        </button>
      </form>

      <section className="stage">
        <span className="label">Courses</span>
        {q.isPending ? (
          <p className="empty">불러오는 중…</p>
        ) : q.data.length === 0 ? (
          <p className="empty">아직 만든 데이트가 없어.</p>
        ) : (
          <ul className="courses">
            {q.data.map((c) => (
              <li key={c.id}>
                <Link
                  className="course-link"
                  to="/plan/$key/$courseId"
                  params={{ key, courseId: c.id }}
                >
                  <span className="d">{formatDate(c.date).md}</span>
                  <span>
                    <b>{c.title}</b>
                    <small>
                      {c.picked}/{c.steps} 단계 골랐어
                    </small>
                  </span>
                  <span className="status" data-s={c.status}>
                    {STATUS[c.status]}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
      <ThemeCard api={api} />
      <GuardCard api={api} plannerKey={key} />
      <BackupCard api={api} plannerKey={key} />
      <Toast message={toast} onDone={clearToast} />
    </main>
  );
}
