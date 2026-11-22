import {
  WebAuthnError,
  browserSupportsWebAuthn,
  startAuthentication,
  startRegistration,
} from "@simplewebauthn/browser";

import { authApi } from "./api";

export const passkeysWork = () => browserSupportsWebAuthn();

/** In-app browsers (KakaoTalk, Instagram, …) often cannot hold passkeys. */
export const inAppBrowser = () =>
  /KAKAOTALK|Instagram|FBAN|FBAV|NAVER\(inapp|Line\//i.test(navigator.userAgent);
export const inKakaoTalk = () => /KAKAOTALK/i.test(navigator.userAgent);

/** KakaoTalk can hand the current page to the phone's own browser. */
export function openOutsideKakaoTalk() {
  location.href = `kakaotalk://web/openExternal?url=${encodeURIComponent(location.href)}`;
}

/** What went wrong, in the app's words. */
function said(e: unknown): Error {
  const name =
    e instanceof WebAuthnError
      ? ((e.cause as Error | undefined)?.name ?? e.name)
      : e instanceof Error
        ? e.name
        : "";
  if (name === "NotAllowedError" || name === "AbortError")
    return new Error("취소했거나 시간이 지났어. 다시 눌러 줘");
  if (name === "InvalidStateError")
    return new Error("이 기기는 이미 등록돼 있어. 처음 화면에서 들어가 줘");
  if (name === "SecurityError") return new Error("이 주소에서는 패스키를 쓸 수 없어");
  return e instanceof Error ? e : new Error("문제가 생겼어. 다시 해 줘");
}

/** Registers this device's passkey with a single-use link; signs in on success. */
export async function registerDevice(token: string) {
  const { flow, options } = await authApi.registerStart(token);
  let credential;
  try {
    credential = await startRegistration({ optionsJSON: options.publicKey as never });
  } catch (e) {
    throw said(e);
  }
  await authApi.registerFinish(flow, credential);
}

/** Signs in with a passkey on this device (or, through the browser, a phone nearby). */
export async function signIn() {
  const { flow, options } = await authApi.signInStart();
  let credential;
  try {
    credential = await startAuthentication({ optionsJSON: options.publicKey as never });
  } catch (e) {
    throw said(e);
  }
  await authApi.signInFinish(flow, credential);
}
