import { inAppBrowser, inKakaoTalk, openOutsideKakaoTalk } from "../lib/passkey";

/** In-app browsers can rarely hold passkeys: point to the phone's own browser. */
export function OutsideHint() {
  if (!inAppBrowser()) return null;
  return (
    <div className="outside">
      <p>
        {inKakaoTalk()
          ? "카카오톡 안에서는 패스키가 안 될 수 있어."
          : "앱 안의 브라우저에서는 패스키가 안 될 수 있어. 메뉴에서 '다른 브라우저로 열기'를 눌러 줘."}
      </p>
      {inKakaoTalk() && (
        <button className="btn small" onClick={openOutsideKakaoTalk}>
          기본 브라우저로 열기
        </button>
      )}
    </div>
  );
}

/** A face-scan mark: four corners, eyes and a smile. */
export function PasskeyGlyph() {
  return (
    <svg
      className="pk-glyph"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 8V5.5A2.5 2.5 0 0 1 5.5 3H8M16 3h2.5A2.5 2.5 0 0 1 21 5.5V8M21 16v2.5a2.5 2.5 0 0 1-2.5 2.5H16M8 21H5.5A2.5 2.5 0 0 1 3 18.5V16M9 9v1.5M15 9v1.5M12 9v4h-1M9.5 16.5c1.4 1 3.6 1 5 0" />
    </svg>
  );
}
