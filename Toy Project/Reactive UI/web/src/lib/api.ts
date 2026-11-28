/** Typed client for the Rust API (same origin in production, proxied in dev). */

/** Step icons; keep in step with `KINDS` in `server/src/validate.rs`. */
export type Kind =
  | "meal"
  | "cafe"
  | "dinner"
  | "drink"
  | "walk"
  | "play"
  | "shop"
  | "photo"
  | "drive"
  | "arcade"
  | "stay"
  | "movie"
  | "show"
  | "exhibit"
  | "home";
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
  /** from the Naver Map link (or a work's theater); null when unknown */
  lat: number | null;
  lng: number | null;
  /** a work's info or booking page */
  link_url: string;
  /** a work's start time, "19:20" or "" */
  starts_at: string;
  runtime_min: number | null;
  /** a work's theater */
  venue: string | null;
}

/** Where they really went at a stop when the day changed the plan (the plan itself stays). */
export interface Actual {
  /** they did not go anywhere for this stop */
  skipped: boolean;
  /** where they went instead ("" when skipped) */
  name: string;
  memo: string;
  map_url: string;
  image_url: string;
  lat: number | null;
  lng: number | null;
}

export interface StepSummary {
  id: string;
  kind: Kind;
  label: string;
  time: string;
  /** fixed: the planner decided (one candidate) · done: chosen in a game · open: still to choose */
  state: "fixed" | "done" | "open";
  picked: Place | null;
  /** set when the day went differently */
  actual: Actual | null;
}

export interface OpenStep {
  id: string;
  kind: Kind;
  label: string;
  title: string;
  time: string;
  game: GameId;
  rerolls_left: number;
  /** a movie, show or exhibition step's theater */
  venue: { name: string; map_url: string } | null;
  candidates: Place[];
}

/** How the pages behind the birthday look: the usual paper, or winter night, snow and lights. */
export type Theme = "plain" | "holiday";

export interface PickView {
  title: string;
  date: string;
  status: CourseStatus;
  steps: StepSummary[];
  /** the steps still to choose, in course order; she plays them in any order */
  open: OpenStep[];
  /** places they dropped by on the day, each after one of the steps */
  extras: Extra[];
}

/** A place they dropped by on the day that was never in the plan. */
export interface Extra {
  id: string;
  /** the stop it came after; null (or a stop since removed) puts it at the end */
  after_step_id: string | null;
  time: string;
  kind: Kind;
  name: string;
  memo: string;
  map_url: string;
  image_url: string;
  lat: number | null;
  lng: number | null;
}

export type ExtraInput = Partial<
  Pick<Extra, "after_step_id" | "time" | "kind" | "name" | "memo" | "map_url">
>;

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
  link_url: string;
  starts_at: string;
  runtime_min: number | null;
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
  /** picker: chosen in a game · planner: a single candidate, so fixed ("정해 둠") */
  picked_by: "picker" | "planner" | null;
  /** a movie, show or exhibition step's theater (one for every candidate) */
  venue_name: string;
  venue_url: string;
  venue_lat: number | null;
  venue_lng: number | null;
  candidates: Candidate[];
  /** set when the day went differently */
  actual: Actual | null;
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
  /** places they dropped by on the day */
  extras: Extra[];
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
  /** "replaced": name is where they went instead; "skipped": name is the planned place;
   * "added": a place they dropped by */
  changed: "replaced" | "skipped" | "added" | null;
}

/** A shared course in the archive (drafts never appear). */
export interface Memory {
  share_code: string;
  title: string;
  date: string;
  status: "open" | "done";
  stops: MemoryStop[];
  /** our own photos of the day (up to four), for the card */
  photos: string[];
}

/** A photo in a course's album (the image is at photoUrl). */
export interface AlbumPhoto {
  id: string;
  /** the stop it was taken at; null for the day in general */
  step_id: string | null;
  width: number;
  height: number;
  /** unix seconds */
  created_at: number;
}

export const photoUrl = (id: string, thumb = false) =>
  `/api/archive/photos/${encodeURIComponent(id)}${thumb ? "/thumb" : ""}`;

/** One guess at the archive passcode, as the planner sees it. */
export interface GuardAttempt {
  /** unix seconds */
  at: number;
  ok: boolean;
  /** partly hidden IPv4, or an IPv6 /64 */
  address: string;
  agent: string;
}

/** The birthday lock's state on the planner page. */
export interface ArchiveGuard {
  enabled: boolean;
  turnstile: boolean;
  /** unix seconds; set while too many misses keep the archive locked */
  locked_at: number | null;
  misses_today: number;
  daily_limit: number;
  recent: GuardAttempt[];
}

/** A place someone wants to go, kept in the archive. */
export interface Wish {
  id: string;
  name: string;
  memo: string;
  map_url: string;
  /** "" when there is no photo */
  image_url: string;
  /** e.g. "중식당"; "" when unknown */
  category: string;
  /** e.g. "논현동"; "" when unknown */
  area: string;
  /** unix seconds */
  created_at: number;
  /** set once a finished course picked it */
  visited: { title: string; date: string; share_code: string } | null;
}

/** A wish as the planner sees it: also the courses it went into. */
export interface PlannerWish extends Wish {
  used: { course_id: string; title: string; date: string; status: CourseStatus }[];
}

/** The daily database backup, as the planner sees it. Times are unix seconds. */
export interface BackupStatus {
  configured: boolean;
  last_ok: number | null;
  last_bytes: number | null;
  last_error: string | null;
  last_error_at: number | null;
}

export type StepInput = Partial<
  Pick<Step, "kind" | "label" | "title" | "time" | "game" | "rerolls" | "venue_url" | "venue_name">
>;
/** runtime_min: 0 clears it */
export type CandidateInput = Partial<
  Pick<Candidate, "name" | "memo" | "map_url" | "image_url" | "link_url" | "starts_at"> & {
    runtime_min: number;
  }
>;

export class ApiError extends Error {
  readonly status: number;
  /** seconds until another try is allowed, when the server says */
  readonly retryAfter: number | null;
  constructor(status: number, message: string, retryAfter: number | null = null) {
    super(message);
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

async function request<T>(
  method: string,
  path: string,
  opts: { body?: unknown; key?: string; blob?: Blob } = {},
): Promise<T> {
  const headers = new Headers({ Accept: "application/json" });
  if (opts.blob) headers.set("Content-Type", opts.blob.type || "application/octet-stream");
  else if (opts.body !== undefined) headers.set("Content-Type", "application/json");
  if (opts.key) headers.set("X-Planner-Key", opts.key);
  const res = await fetch(`/api${path}`, {
    method,
    headers,
    body: opts.blob ?? (opts.body === undefined ? undefined : JSON.stringify(opts.body)),
  });
  if (res.status === 204) return undefined as T;
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const message =
      data && typeof data === "object" && "error" in data && typeof data.error === "string"
        ? data.error
        : `요청이 실패했어 (${res.status})`;
    const retry =
      data &&
      typeof data === "object" &&
      "retry_after" in data &&
      typeof data.retry_after === "number"
        ? data.retry_after
        : null;
    throw new ApiError(res.status, message, retry);
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
  /** digits of the archive passcode (a birthday); null when the archive is closed */
  archive_digits: number | null;
  /** Cloudflare Turnstile site key the passcode form must pass; null when not required */
  turnstile_site_key: string | null;
  /** how every page behind the birthday looks */
  theme: Theme;
}

export const configApi = {
  get: () => request<ClientConfig>("GET", "/config"),
};

/** Every shared course, behind the birthday; the server keeps the session in an HttpOnly cookie. */
export const archiveApi = {
  list: () => request<Memory[]>("GET", "/archive"),
  unlock: (code: string, turnstile = "") =>
    request<void>("POST", "/archive/unlock", { body: { code, turnstile } }),
  lock: () => request<void>("POST", "/archive/lock"),
};

/** The wishlist, behind the birthday like the archive. `link` may be a whole share text. */
export const wishApi = {
  list: () => request<Wish[]>("GET", "/archive/wishes"),
  add: (link: string, name: string, memo: string) =>
    request<Wish>("POST", "/archive/wishes", { body: { link, name, memo } }),
  remove: (id: string) => request<void>("DELETE", `/archive/wishes/${encodeURIComponent(id)}`),
};

/** Photos of a course's day, behind the birthday like the archive. */
/** Changing a decided stop after the fact (signed in with the birthday). */
export const dayApi = {
  set: (
    code: string,
    stepId: string,
    body: { skipped?: boolean; name?: string; memo?: string; map_url?: string },
  ) =>
    request<PickView>(
      "PUT",
      `/archive/courses/${encodeURIComponent(code)}/steps/${stepId}/actual`,
      { body },
    ),
  clear: (code: string, stepId: string) =>
    request<PickView>(
      "DELETE",
      `/archive/courses/${encodeURIComponent(code)}/steps/${stepId}/actual`,
    ),
  addExtra: (code: string, body: ExtraInput) =>
    request<PickView>("POST", `/archive/courses/${encodeURIComponent(code)}/extras`, { body }),
  editExtra: (code: string, id: string, body: ExtraInput) =>
    request<PickView>("PUT", `/archive/courses/${encodeURIComponent(code)}/extras/${id}`, {
      body,
    }),
  removeExtra: (code: string, id: string) =>
    request<PickView>("DELETE", `/archive/courses/${encodeURIComponent(code)}/extras/${id}`),
};

export const albumApi = {
  list: (code: string) =>
    request<AlbumPhoto[]>("GET", `/archive/courses/${encodeURIComponent(code)}/photos`),
  upload: (code: string, photo: Blob, step: string | null) =>
    request<AlbumPhoto>(
      "POST",
      `/archive/courses/${encodeURIComponent(code)}/photos${step ? `?step=${encodeURIComponent(step)}` : ""}`,
      { blob: photo },
    ),
  remove: (id: string) => request<void>("DELETE", `/archive/photos/${encodeURIComponent(id)}`),
};

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
    setTheme: (theme: Theme) => r<{ theme: Theme }>("PUT", "/theme", { theme }),
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
    /** a poster or picture for the card, already shrunk by the browser */
    uploadImage: (id: string, photo: Blob) =>
      request<CourseFull>("POST", `/plan/candidates/${id}/image`, { blob: photo, key }),
    guard: () => r<ArchiveGuard>("GET", "/archive"),
    backup: () => r<BackupStatus>("GET", "/backup"),
    wishes: () => r<PlannerWish[]>("GET", "/wishes"),
    fromWish: (stepId: string, wishId: string) =>
      r<CourseFull>("POST", `/steps/${stepId}/wishes`, { wish_id: wishId }),
    backupNow: () => r<BackupStatus>("POST", "/backup"),
    reopenArchive: () => r<ArchiveGuard>("POST", "/archive/reopen"),
  };
}

export const errorMessage = (e: unknown) =>
  e instanceof Error ? e.message : "문제가 생겼어. 다시 시도해 줘";
