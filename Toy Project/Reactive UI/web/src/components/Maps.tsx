import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";

import { type Place, type StepSummary, configApi } from "../lib/api";
import { auraBase, two } from "../lib/look";

/* The slice of Naver's map script (maps.js v3) used here. */
type LatLng = object;
interface NaverMap {
  fitBounds(
    bounds: object,
    margin?: { top: number; right: number; bottom: number; left: number },
  ): void;
  destroy(): void;
}
interface NaverMaps {
  Map: new (el: HTMLElement, options: Record<string, unknown>) => NaverMap;
  LatLng: new (lat: number, lng: number) => LatLng;
  LatLngBounds: new (sw: LatLng, ne: LatLng) => { extend(p: LatLng): void };
  Marker: new (options: Record<string, unknown>) => object;
  Polyline: new (options: Record<string, unknown>) => object;
  Point: new (x: number, y: number) => object;
}
declare global {
  interface Window {
    naver?: { maps?: NaverMaps };
    /** called by the map script when the client ID is refused for this domain */
    navermap_authFailure?: () => void;
  }
}

let loading: Promise<NaverMaps> | null = null;

function loadMaps(clientId: string): Promise<NaverMaps> {
  if (window.naver?.maps) return Promise.resolve(window.naver.maps);
  loading ??= new Promise<NaverMaps>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = `https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=${encodeURIComponent(clientId)}`;
    s.async = true;
    s.onload = () =>
      window.naver?.maps ? resolve(window.naver.maps) : reject(new Error("no naver.maps"));
    s.onerror = () => {
      loading = null;
      reject(new Error("map script failed"));
    };
    document.head.append(s);
  });
  return loading;
}

interface Stop {
  id: string;
  /** what the pin says: a course order ("1") or a card number ("03") */
  no: string;
  name: string;
  lat: number;
  lng: number;
  /** pin colour; the accent when absent */
  color?: string;
}

/**
 * Numbered pin with the place name; built as DOM so names are never parsed as HTML.
 * With `tapToName` the name stays hidden until the pin is tapped (for crowded maps).
 */
function pin(stop: Stop, tapToName: boolean) {
  const el = document.createElement("div");
  el.className = tapToName ? "cm-pin tap" : "cm-pin";
  if (tapToName) {
    el.title = stop.name;
    el.addEventListener("click", () => {
      el.classList.toggle("show");
      el.parentElement?.style.setProperty("z-index", el.classList.contains("show") ? "200" : "");
    });
  }
  const b = document.createElement("b");
  b.textContent = stop.no;
  if (stop.color) b.style.background = stop.color;
  const span = document.createElement("span");
  span.textContent = stop.name;
  el.append(b, span);
  return el;
}

const located = (p: Place | null | undefined): p is Place & { lat: number; lng: number } =>
  !!p && p.lat !== null && p.lng !== null;

function useClientId() {
  const cfg = useQuery({ queryKey: ["config"], queryFn: configApi.get, staleTime: Infinity });
  return cfg.data?.naver_map_client_id ?? null;
}

/**
 * A Naver map showing `stops`. `route` joins them in order with a dashed line (and labels every
 * pin); without it pins show only their number until tapped.
 */
function MapView(props: { clientId: string; stops: Stop[]; route: boolean; onFail: () => void }) {
  const { clientId, stops, route, onFail } = props;
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = box.current;
    if (!el || stops.length === 0) return;
    let map: NaverMap | null = null;
    let gone = false;
    window.navermap_authFailure = onFail;
    loadMaps(clientId)
      .then((maps) => {
        if (gone) return;
        const pts = stops.map((s) => new maps.LatLng(s.lat, s.lng));
        map = new maps.Map(el, {
          center: pts[0],
          zoom: 16,
          zoomControl: false,
          scaleControl: false,
          mapDataControl: false,
        });
        stops.forEach(
          (s, i) =>
            new maps.Marker({
              map,
              position: pts[i],
              title: s.name,
              icon: { content: pin(s, !route), anchor: new maps.Point(13, 13) },
            }),
        );
        if (pts.length < 2) return;
        if (route) {
          const accent = getComputedStyle(document.documentElement)
            .getPropertyValue("--accent")
            .trim();
          new maps.Polyline({
            map,
            path: pts,
            strokeColor: accent || "#9b1c34",
            strokeWeight: 3,
            strokeOpacity: 0.85,
            strokeStyle: "shortdash",
          });
        }
        const bounds = new maps.LatLngBounds(pts[0], pts[0]);
        for (const p of pts) bounds.extend(p);
        // room on the right for the name labels
        map.fitBounds(
          bounds,
          route
            ? { top: 48, right: 96, bottom: 36, left: 36 }
            : { top: 36, right: 36, bottom: 36, left: 36 },
        );
      })
      .catch(onFail);
    return () => {
      gone = true;
      map?.destroy();
    };
  }, [clientId, stops, route, onFail]);
  return <div className="cm-box" ref={box} />;
}

/** The finished course under the ticket: one pin per step in order, joined by a dashed line. */
export function CourseMap({ steps }: { steps: StepSummary[] }) {
  const clientId = useClientId();
  const [failed, setFailed] = useState(false);
  const stops = useMemo(
    () =>
      steps.flatMap((s, i): Stop[] =>
        located(s.picked)
          ? [
              {
                id: s.id,
                no: String(i + 1),
                name: s.picked.name,
                lat: s.picked.lat,
                lng: s.picked.lng,
              },
            ]
          : [],
      ),
    [steps],
  );
  const fail = useMemo(() => () => setFailed(true), []);
  if (!clientId || stops.length === 0 || failed) return null;
  return (
    <section className="course-map" aria-label="오늘의 동선 지도">
      <span className="label">오늘의 동선</span>
      <MapView clientId={clientId} stops={stops} route onFail={fail} />
    </section>
  );
}

/**
 * Where this step's candidates are, folded away until asked for. Pins carry each card's number
 * and colour, so a pin and its card match at a glance.
 */
export function CandidateMap(props: { candidates: Place[]; indexOf: (p: Place) => number }) {
  const { candidates, indexOf } = props;
  const clientId = useClientId();
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  const stops = useMemo(
    () =>
      candidates.flatMap((c): Stop[] =>
        located(c)
          ? [
              {
                id: c.id,
                no: two(indexOf(c)),
                name: c.name,
                lat: c.lat,
                lng: c.lng,
                color: auraBase(indexOf(c)),
              },
            ]
          : [],
      ),
    [candidates, indexOf],
  );
  const fail = useMemo(() => () => setFailed(true), []);
  if (!clientId || stops.length === 0 || failed) return null;
  return (
    <div className={`cand-map${open ? " open" : ""}`}>
      <button className="map-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 21.5s-6.5-6-6.5-11a6.5 6.5 0 0 1 13 0c0 5-6.5 11-6.5 11z" />
          <circle cx="12" cy="10.5" r="2.3" />
        </svg>
        {open ? "후보 위치 접기" : `후보 위치 보기 · ${stops.length}곳`}
      </button>
      {open && (
        <>
          <MapView clientId={clientId} stops={stops} route={false} onFail={fail} />
          <p className="hint cm-hint">번호는 카드 번호와 같아 · 핀을 누르면 이름이 보여</p>
        </>
      )}
    </div>
  );
}
