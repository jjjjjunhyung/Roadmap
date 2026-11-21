/** Typed client for the Rust API (same origin in production, proxied in dev). */

export type Kind = "meal" | "cafe" | "play" | "dinner" | "drink" | "walk";
export type GameId = "worldcup" | "swipe" | "flip" | "roulette" | "slot" | "ladder" | "gacha";
export type CourseStatus = "draft" | "open" | "done";

export interface Place {
  id: string;
  name: string;
  memo: string;
  map_url: string;
}

export interface StepSummary {
  id: string;
  kind: Kind;
  label: string;
  time: string;
  state: "done" | "current" | "locked";
  picked: Place | null;
}

export interface CurrentStep {
  id: string;
  kind: Kind;
  label: string;
  title: string;
  time: string;
  game: GameId;
  rerolls_left: number;
  candidates: Place[];
}

export interface PickView {
  title: string;
  date: string;
  status: CourseStatus;
  steps: StepSummary[];
  current: CurrentStep | null;
  /** client-only: a pick was sent and the next step is on its way */
  pending?: boolean;
}

export interface Candidate {
  id: string;
  step_id: string;
  position: number;
  name: string;
  memo: string;
  map_url: string;
}

export interface Step {
  id: string;
  position: number;
  kind: Kind;
  label: string;
  title: string;
  time: string;
  game: GameId;
  rerolls: number;
  rerolls_used: number;
  picked_id: string | null;
  picked_at: string | null;
  candidates: Candidate[];
}

export interface CourseFull {
  id: string;
  share_code: string;
  title: string;
  date: string;
  status: CourseStatus;
  created_at: string;
  updated_at: string;
  steps: Step[];
}

export interface CourseSummary {
  id: string;
  share_code: string;
  title: string;
  date: string;
  status: CourseStatus;
  updated_at: string;
  steps: number;
  picked: number;
}

export type StepInput = Partial<
  Pick<Step, "kind" | "label" | "title" | "time" | "game" | "rerolls">
>;
export type CandidateInput = Partial<Pick<Candidate, "name" | "memo" | "map_url">>;

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(
  method: string,
  path: string,
  opts: { body?: unknown; key?: string } = {},
): Promise<T> {
  const headers = new Headers({ Accept: "application/json" });
  if (opts.body !== undefined) headers.set("Content-Type", "application/json");
  if (opts.key) headers.set("X-Planner-Key", opts.key);
  const res = await fetch(`/api${path}`, {
    method,
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  if (res.status === 204) return undefined as T;
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const message =
      data && typeof data === "object" && "error" in data && typeof data.error === "string"
        ? data.error
        : `요청이 실패했어 (${res.status})`;
    throw new ApiError(res.status, message);
  }
  return data as T;
}

export const pickApi = {
  view: (code: string) => request<PickView>("GET", `/pick/${encodeURIComponent(code)}`),
  choose: (code: string, stepId: string, candidateId: string) =>
    request<PickView>("POST", `/pick/${encodeURIComponent(code)}/steps/${stepId}/pick`, {
      body: { candidate_id: candidateId },
    }),
  reroll: (code: string, stepId: string) =>
    request<{ rerolls_left: number }>(
      "POST",
      `/pick/${encodeURIComponent(code)}/steps/${stepId}/reroll`,
    ),
};

export function planApi(key: string) {
  const r = <T>(method: string, path: string, body?: unknown) =>
    request<T>(method, `/plan${path}`, { body, key });
  return {
    list: () => r<CourseSummary[]>("GET", "/courses"),
    create: (title: string, date: string) => r<CourseFull>("POST", "/courses", { title, date }),
    course: (id: string) => r<CourseFull>("GET", `/courses/${id}`),
    update: (
      id: string,
      body: Partial<Pick<CourseFull, "title" | "date">> & { status?: "draft" | "open" },
    ) => r<CourseFull>("PATCH", `/courses/${id}`, body),
    remove: (id: string) => r<void>("DELETE", `/courses/${id}`),
    reset: (id: string) => r<CourseFull>("POST", `/courses/${id}/reset`),
    addStep: (id: string, body: StepInput) => r<CourseFull>("POST", `/courses/${id}/steps`, body),
    order: (id: string, ids: string[]) =>
      r<CourseFull>("PUT", `/courses/${id}/steps/order`, { ids }),
    updateStep: (stepId: string, body: StepInput) =>
      r<CourseFull>("PATCH", `/steps/${stepId}`, body),
    removeStep: (stepId: string) => r<CourseFull>("DELETE", `/steps/${stepId}`),
    addCandidate: (stepId: string, body: CandidateInput) =>
      r<CourseFull>("POST", `/steps/${stepId}/candidates`, body),
    updateCandidate: (id: string, body: CandidateInput) =>
      r<CourseFull>("PATCH", `/candidates/${id}`, body),
    removeCandidate: (id: string) => r<CourseFull>("DELETE", `/candidates/${id}`),
  };
}

export const errorMessage = (e: unknown) =>
  e instanceof Error ? e.message : "문제가 생겼어. 다시 시도해 줘";
