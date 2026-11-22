import { type RefObject, useCallback, useEffect, useRef } from "react";

/* The slice of Cloudflare Turnstile's script (explicit rendering) used here. */
interface TurnstileApi {
  render(el: HTMLElement, options: Record<string, unknown>): string;
  reset(id: string): void;
  remove(id: string): void;
}
declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let loading: Promise<TurnstileApi> | null = null;

function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  loading ??= new Promise<TurnstileApi>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    s.async = true;
    s.onload = () =>
      window.turnstile ? resolve(window.turnstile) : reject(new Error("no turnstile"));
    s.onerror = () => {
      loading = null;
      reject(new Error("turnstile script failed"));
    };
    document.head.append(s);
  });
  return loading;
}

const WAIT_MS = 20_000;

/**
 * Cloudflare Turnstile in "interaction-only" mode, rendered into `box`: nothing shows unless
 * Cloudflare wants a click. `token()` hands out a fresh pass (waiting for one if needed; each works once), and
 * `reset()` asks for the next. Without a site key it does nothing and `token()` gives "".
 */
export function useTurnstile(siteKey: string | null, box: RefObject<HTMLDivElement | null>) {
  const live = useRef<{ id?: string; token?: string; waiters: ((t: string) => void)[] }>({
    waiters: [],
  });

  useEffect(() => {
    const el = box.current;
    if (!siteKey || !el) return;
    const state = { waiters: [] } as {
      id?: string;
      token?: string;
      waiters: ((t: string) => void)[];
    };
    live.current = state;
    let api: TurnstileApi | null = null;
    let gone = false;
    loadTurnstile()
      .then((ts) => {
        if (gone) return;
        api = ts;
        state.id = ts.render(el, {
          sitekey: siteKey,
          action: "archive",
          appearance: "interaction-only",
          theme: "auto",
          language: "ko",
          size: "flexible",
          callback: (t: string) => {
            const next = state.waiters.shift();
            if (next) next(t);
            else state.token = t;
          },
          "expired-callback": () => {
            state.token = undefined;
            if (state.id) ts.reset(state.id);
          },
        });
      })
      .catch(() => undefined);
    return () => {
      gone = true;
      if (api && state.id) api.remove(state.id);
    };
  }, [siteKey, box]);

  const token = useCallback((): Promise<string> => {
    if (!siteKey) return Promise.resolve("");
    const state = live.current;
    if (state.token) {
      const t = state.token;
      state.token = undefined;
      return Promise.resolve(t);
    }
    return new Promise<string>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        state.waiters = state.waiters.filter((w) => w !== done);
        reject(new Error("사람 확인이 끝나지 않았어. 화면을 새로 고쳐 줘"));
      }, WAIT_MS);
      const done = (t: string) => {
        clearTimeout(timer);
        resolve(t);
      };
      state.waiters.push(done);
    });
  }, [siteKey]);

  const reset = useCallback(() => {
    const state = live.current;
    state.token = undefined;
    if (state.id) window.turnstile?.reset(state.id);
  }, []);

  return { token, reset };
}
