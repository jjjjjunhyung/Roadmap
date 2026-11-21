import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

import { healthQuery } from "../lib/api";

export const Route = createFileRoute("/")({
  component: Home,
});

function Home() {
  const health = useQuery(healthQuery);

  return (
    <section className="card">
      <h1>준비 중이에요</h1>
      <p className="muted">데이트 일정을 함께 정리하는 공간을 만들고 있어요.</p>
      <p
        className="status"
        data-state={health.isError ? "error" : (health.data?.status ?? "loading")}
      >
        {health.isPending && "서버 확인 중…"}
        {health.isError && "서버에 연결할 수 없어요"}
        {health.data &&
          `서버 ${health.data.status} · DB ${health.data.db} · v${health.data.version}`}
      </p>
    </section>
  );
}
