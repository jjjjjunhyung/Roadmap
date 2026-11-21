import type { QueryClient } from "@tanstack/react-query";
import { createRootRouteWithContext, Link, Outlet } from "@tanstack/react-router";

interface RouterContext {
  queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
  notFoundComponent: () => (
    <section className="card">
      <h2>페이지를 찾을 수 없어요</h2>
      <Link to="/">처음으로</Link>
    </section>
  ),
});

function RootLayout() {
  return (
    <div className="app">
      <header className="app-header">
        <Link to="/" className="brand">
          Reactive UI
        </Link>
      </header>
      <main className="app-main">
        <Outlet />
      </main>
    </div>
  );
}
