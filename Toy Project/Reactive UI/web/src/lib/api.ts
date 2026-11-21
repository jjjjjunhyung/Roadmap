/** Thin fetch wrapper for the Rust API (same origin in production, proxied in dev). */
export async function getJson<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set("Accept", "application/json");
  const res = await fetch(`/api${path}`, { ...init, headers });
  if (!res.ok) {
    throw new Error(`${init?.method ?? "GET"} /api${path} failed: ${res.status}`);
  }
  return (await res.json()) as T;
}

export interface Health {
  status: "ok" | "degraded";
  version: string;
  revision: string;
  db: "ok" | "error";
}

export const healthQuery = {
  queryKey: ["health"] as const,
  queryFn: () => getJson<Health>("/health"),
};
