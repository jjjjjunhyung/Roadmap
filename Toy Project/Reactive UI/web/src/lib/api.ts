/** Typed client for the Rust API (same origin in production, proxied in dev). */

export type Kind = "meal" | "cafe" | "play" | "dinner" | "drink" | "walk";
export type GameId =
  | "worldcup"
  | "swipe"
  | "flip"
  | "roulette"
  | "slot"
  | "ladder"
  | "gacha"
  | "balance";
export type CourseStatus = "draft" | "open" | "done";

export interface Place {
  id: string;
  name: string;
  memo: string;
  map_url: string;
  /** "" when the card has no photo */
  image_url: string;
  /** from the Naver Map link; null when unknown */
  lat: number | null;
  lng: number | null;
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
  image_url: string;
  lat: number | null;
  lng: number | null;
}

/** A photo the planner can choose for a candidate (from its Naver Map link). */
export interface PhotoOption {
  url: string;
  label: string;
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

/** One step of a shared course in the archive; `name` is null until it has been picked. */
export interface MemoryStop {
  label: string;
  kind: Kind;
  time: string;
  name: string | null;
  image_url: string | null;
}

/** A shared course in the archive (drafts never appear). */
export interface Memory {
  share_code: string;
  title: string;
  date: string;
  status: "open" | "done";
  stops: MemoryStop[];
}

export type StepInput = Partial<
  Pick<Step, "kind" | "label" | "title" | "time" | "game" | "rerolls">
>;
export type CandidateInput = Partial<Pick<Candidate, "name" | "memo" | "map_url" | "image_url">>;

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

/** The weather on a course's day (Open-Meteo). */
export interface WeatherDay {
  /** WMO weather code */
  code: number;
  max: number;
  min: number;
  /** percent; forecasts only */
  rain_chance: number | null;
  /** millimetres */
  precip: number | null;
}

export interface WeatherHour {
  code: number;
  temp: number;
  rain_chance: number | null;
}

export interface WeatherReport {
  /** "far": more than 15 days ahead; "none": unavailable */
  status: "forecast" | "past" | "far" | "none";
  days_until: number | null;
  day: WeatherDay | null;
  /** local hours 0–23, or empty */
  hours: WeatherHour[];
}

export interface ClientConfig {
  naver_map_client_id: string | null;
  /** passkey sign-in (and so the archive) is available */
  auth: boolean;
}

export const configApi = {
  get: () => request<ClientConfig>("GET", "/config"),
};

/** Every shared course, for a signed-in person (session in an HttpOnly cookie). */
export const archiveApi = {
  list: () => request<Memory[]>("GET", "/archive"),
};

/** Someone who may open the archive. */
export interface Me {
  id: string;
  name: string;
}

/** A passkey ceremony begun by the server: `options` go to the browser as they are. */
export interface Ceremony {
  flow: string;
  options: { publicKey: Record<string, unknown> };
}

/** Passkey sign-in, device registration through a single-use link, and sign-out. */
export const authApi = {
  me: () => request<Me>("GET", "/auth/me"),
  invite: (token: string) =>
    request<{ name: string; expires_at: number }>(
      "GET",
      `/auth/invite/${encodeURIComponent(token)}`,
    ),
  registerStart: (token: string) =>
    request<Ceremony>("POST", `/auth/invite/${encodeURIComponent(token)}/register`),
  registerFinish: (flow: string, credential: unknown) =>
    request<void>("POST", "/auth/register", { body: { flow, credential } }),
  enter: (token: string) =>
    request<void>("POST", `/auth/invite/${encodeURIComponent(token)}/enter`),
  signInStart: () => request<Ceremony>("POST", "/auth/signin/start"),
  signInFinish: (flow: string, credential: unknown) =>
    request<void>("POST", "/auth/signin", { body: { flow, credential } }),
  logout: () => request<void>("POST", "/auth/logout"),
};

/** A registered device, as the planner sees it. */
export interface Device {
  id: string;
  agent: string;
  /** unix seconds */
  created_at: number;
  used_at: number;
}

export interface PersonView {
  id: string;
  name: string;
  devices: Device[];
  sessions: number;
  open_invites: number;
}

export const pickApi = {
  view: (code: string) => request<PickView>("GET", `/pick/${encodeURIComponent(code)}`),
  weather: (code: string) =>
    request<WeatherReport>("GET", `/pick/${encodeURIComponent(code)}/weather`),
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
    weather: (id: string) => r<WeatherReport>("GET", `/courses/${id}/weather`),
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
    photos: (id: string) => r<PhotoOption[]>("GET", `/candidates/${id}/photos`),
    people: () => r<PersonView[]>("GET", "/people"),
    invite: (name: string) =>
      r<{ token: string; expires_at: number; people: PersonView[] }>("POST", "/invites", { name }),
    removeDevice: (id: string) => r<PersonView[]>("DELETE", `/passkeys/${encodeURIComponent(id)}`),
    signOut: (person: string) => r<PersonView[]>("DELETE", `/people/${person}/sessions`),
    removePerson: (person: string) => r<PersonView[]>("DELETE", `/people/${person}`),
  };
}

export const errorMessage = (e: unknown) =>
  e instanceof Error ? e.message : "문제가 생겼어. 다시 시도해 줘";
