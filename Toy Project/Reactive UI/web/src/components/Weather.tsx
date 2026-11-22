import type { WeatherDay, WeatherReport } from "../lib/api";

type Sky = "sun" | "partly" | "cloud" | "fog" | "drizzle" | "rain" | "snow" | "storm";

/** WMO weather code → a word and an icon. */
function sky(code: number): { label: string; icon: Sky } {
  if (code === 0) return { label: "맑음", icon: "sun" };
  if (code === 1) return { label: "대체로 맑음", icon: "sun" };
  if (code === 2) return { label: "구름 조금", icon: "partly" };
  if (code === 3) return { label: "흐림", icon: "cloud" };
  if (code === 45 || code === 48) return { label: "안개", icon: "fog" };
  if (code >= 51 && code <= 57) return { label: "이슬비", icon: "drizzle" };
  if (code === 65) return { label: "많은 비", icon: "rain" };
  if (code >= 61 && code <= 67) return { label: "비", icon: "rain" };
  if (code >= 71 && code <= 77) return { label: "눈", icon: "snow" };
  if (code >= 80 && code <= 82) return { label: "소나기", icon: "rain" };
  if (code === 85 || code === 86) return { label: "눈", icon: "snow" };
  if (code >= 95) return { label: "뇌우", icon: "storm" };
  return { label: "흐림", icon: "cloud" };
}

const CLOUD = "M6.5 19a4.5 4.5 0 0 1-.5-8.97A6 6 0 0 1 17.6 9.1 5 5 0 0 1 17 19z";

export function WeatherIcon({ code }: { code: number }) {
  const s = sky(code).icon;
  const up = s === "cloud" || s === "partly" ? undefined : "translate(0 -3)";
  return (
    <svg
      className={`wx-icon wx-${s}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {s === "sun" ? (
        <>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" />
        </>
      ) : s === "partly" ? (
        <>
          <circle cx="8" cy="8" r="3" />
          <path d="M8 2.2v1.3M2.2 8h1.3M3.9 3.9l.9.9M12.1 3.9l-.9.9" />
          <path className="wx-mask" d={CLOUD} transform="translate(3 2) scale(0.85)" />
        </>
      ) : (
        <>
          <path d={CLOUD} transform={up} />
          {(s === "rain" || s === "drizzle") && (
            <path
              d={
                s === "rain"
                  ? "M8 18.5l-1 3M12 18.5l-1 3M16 18.5l-1 3"
                  : "M9 19l-.5 1.5M15 19l-.5 1.5"
              }
            />
          )}
          {s === "snow" && <path d="M8 19.5h.01M12 21h.01M16 19.5h.01" strokeWidth={2.4} />}
          {s === "storm" && <path d="M12.8 16.5l-2 3h3l-2 3" />}
          {s === "fog" && <path d="M5 19.5h14M7 22h10" />}
        </>
      )}
    </svg>
  );
}

const wet = (d: WeatherDay) =>
  ["drizzle", "rain", "storm"].includes(sky(d.code).icon) || (d.rain_chance ?? 0) >= 50;
const snowy = (d: WeatherDay) => sky(d.code).icon === "snow";

/** What to say about the day: to the picker ("come prepared") or to the planner (plan B). */
function advice(d: WeatherDay, who: "picker" | "planner", outdoor: boolean) {
  if (who === "planner") {
    if ((wet(d) || snowy(d)) && outdoor)
      return `${snowy(d) ? "눈" : "비"} 예보가 있어. 활동·산책엔 실내 후보도 넣어 두면 좋아`;
    if (wet(d) || snowy(d)) return `${snowy(d) ? "눈" : "비"} 예보가 있어`;
    return null;
  }
  if (snowy(d)) return "눈 소식이 있어. 따뜻하게 입고 와";
  if (wet(d)) return "비 소식이 있어. 우산 챙겨 와";
  if (d.min <= -5) return "많이 추워. 단단히 입고 와";
  if (d.max >= 30) return "많이 더워. 시원하게 입고 와";
  return null;
}

const deg = (t: number) => `${Math.round(t)}°`;

/**
 * The day's weather in one line: sky, high / low, chance of rain, and a word of advice for a
 * coming day ("past" shows what it was like; "far" says when it will appear).
 */
export function WeatherStrip(props: {
  report: WeatherReport | undefined;
  who?: "picker" | "planner";
  outdoor?: boolean;
}) {
  const { report, who = "picker", outdoor = false } = props;
  if (!report || report.status === "none") return null;
  if (report.status === "far" || !report.day) {
    return report.status === "far" ? (
      <p className="wx wx-far">날씨는 데이트 15일 전부터 보여</p>
    ) : null;
  }
  const d = report.day;
  const past = report.status === "past";
  const note = past ? null : advice(d, who, outdoor);
  return (
    <div className={`wx${note ? " has-note" : ""}`} aria-label="날씨">
      <WeatherIcon code={d.code} />
      <span className="wx-main">
        <span className="wx-label">
          {past ? "그날 날씨 · " : report.days_until === 0 ? "오늘 · " : ""}
          {sky(d.code).label}
        </span>
        <span className="wx-temp">
          {deg(d.max)}
          <small> / {deg(d.min)}</small>
        </span>
      </span>
      {!past && d.rain_chance !== null && d.rain_chance >= 10 && (
        <span className="wx-chip">비 {d.rain_chance}%</span>
      )}
      {past && d.precip !== null && d.precip >= 1 && (
        <span className="wx-chip">강수 {Math.round(d.precip)}mm</span>
      )}
      {note && <p className="wx-note">{note}</p>}
      <a
        className="wx-credit"
        href="https://open-meteo.com/"
        target="_blank"
        rel="noopener noreferrer"
      >
        Open-Meteo
      </a>
    </div>
  );
}

/** The hour nearest a step's "HH:MM", for the ticket. */
export function HourWeather({ report, time }: { report?: WeatherReport; time: string }) {
  const m = /^(\d{2}):(\d{2})$/.exec(time);
  if (!report || !m || report.hours.length !== 24) return null;
  const h = Math.min(23, Number(m[1]) + (Number(m[2]) >= 30 ? 1 : 0));
  const w = report.hours[h];
  return (
    <span className="wx-hour" aria-label={`${sky(w.code).label} ${deg(w.temp)}`}>
      <WeatherIcon code={w.code} />
      {deg(w.temp)}
    </span>
  );
}
