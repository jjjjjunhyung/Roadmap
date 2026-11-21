import type { QueryClient } from "@tanstack/react-query";
import { Outlet, createRootRouteWithContext } from "@tanstack/react-router";

interface RouterContext {
  queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: Outlet,
  notFoundComponent: () => (
    <main className="page">
      <div className="message">
        <h2>페이지를 찾을 수 없어</h2>
        <p>받은 링크를 다시 확인해 줘.</p>
      </div>
    </main>
  ),
});
