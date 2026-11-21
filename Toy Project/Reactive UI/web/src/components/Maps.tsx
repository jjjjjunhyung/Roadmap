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
  getProjection(): { fromCoordToOffset(c: LatLng): { x: number; y: number } };
  destroy(): void;
}
interface NaverMarker {
  setZIndex(z: number): void;
}
interface NaverMaps {
  Map: new (el: HTMLElement, options: Record<string, unknown>) => NaverMap;
  LatLng: new (lat: number, lng: number) => LatLng;
  LatLngBounds: new (sw: LatLng, ne: LatLng) => { extend(p: LatLng): void };
  Marker: new (options: Record<string, unknown>) => NaverMarker;
  Polyline: new (options: Record<string, unknown>) => object;
  Point: new (x: number, y: number) => object;
  Event: { addListener(target: object, type: string, fn: () => void): object };
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

/** Half the badge: the marker is anchored on the badge's centre. */
const R = 14;

/** Numbered pin with the place name; built as DOM so names are never parsed as HTML. */
function pin(stop: Stop) {
  const el = document.createElement("div");
  el.className = "cm-pin";
  el.title = stop.name;
  const b = document.createElement("b");
  b.textContent = stop.no;
  if (stop.color) b.style.background = stop.color;
  const span = document.createElement("span");
  span.textContent = stop.name;
  el.append(b, span);
  return el;
}

type Box = { x1: number; y1: number; x2: number; y2: number };
const overlaps = (a: Box, b: Box) => a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2;

const located = (p: Place | null | undefined): p is Place & { lat: number; lng: number } =>
  !!p && p.lat !== null && p.lng !== null;

function useClientId() {
  const cfg = useQuery({ queryKey: ["config"], queryFn: configApi.get, staleTime: Infinity });
  return cfg.data?.naver_map_client_id ?? null;
}

/**
 * A Naver map of `stops`. `route` joins them in order with a dashed line. Stops in `focus` are
 * drawn larger and always named; other names are laid out around them so they never cover a name
 * or another pin, and wait for the map to be zoomed in (or their pin tapped) when they would.
 */
function MapView(props: {
  clientId: string;
  stops: Stop[];
  route: boolean;
  focus?: string[];
  onFail: () => void;
}) {
  const { clientId, stops, route, focus = [], onFail } = props;
  const box = useRef<HTMLDivElement>(null);
  // the live map, so focus changes can restyle it without rebuilding
  const live = useRef<{
    pins: HTMLElement[];
    markers: NaverMarker[];
    layout: () => void;
  } | null>(null);
  const focusRef = useRef<string[]>(focus);

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
        const m = new maps.Map(el, {
          center: pts[0],
          zoom: 16,
          zoomControl: false,
          scaleControl: false,
          mapDataControl: false,
          // the page scrolls past this map; a wheel over it shouldn't zoom it (pinch still does)
          scrollWheel: false,
        });
        map = m;
        const pins = stops.map(pin);
        const markers = stops.map(
          (s, i) =>
            new maps.Marker({
              map: m,
              position: pts[i],
              title: s.name,
              icon: { content: pins[i], anchor: new maps.Point(R, R) },
            }),
        );
        if (route && pts.length > 1) {
          const accent = getComputedStyle(document.documentElement)
            .getPropertyValue("--accent")
            .trim();
          new maps.Polyline({
            map: m,
            path: pts,
            strokeColor: accent || "#9b1c34",
            strokeWeight: 3,
            strokeOpacity: 0.85,
            strokeStyle: "shortdash",
          });
        }

        const layout = () => {
          const focused = new Set(focusRef.current.filter((id) => stops.some((s) => s.id === id)));
          const proj = m.getProjection();
          const at = pts.map((p) => proj.fromCoordToOffset(p));
          // every badge is an obstacle; names are placed focus first, then in order
          const badges: Box[] = at.map((p) => ({
            x1: p.x - R,
            y1: p.y - R,
            x2: p.x + R,
            y2: p.y + R,
          }));
          const placed: Box[] = [];
          const order = stops
            .map((_, i) => i)
            .sort(
              (a, b) =>
                Number(focused.has(stops[b].id)) - Number(focused.has(stops[a].id)) || a - b,
            );
          for (const i of order) {
            const p = pins[i];
            const isFocus = focused.has(stops[i].id);
            p.classList.toggle("focus", isFocus);
            p.classList.toggle("dim", focused.size > 0 && !isFocus);
            markers[i].setZIndex(isFocus ? 300 : p.classList.contains("tapped") ? 200 : 100);
            const label = p.querySelector("span");
            if (!label) continue;
            const r: Box = {
              x1: at[i].x - R + label.offsetLeft,
              y1: at[i].y - R + label.offsetTop,
              x2: at[i].x - R + label.offsetLeft + label.offsetWidth,
              y2: at[i].y - R + label.offsetTop + label.offsetHeight,
            };
            const clear =
              !placed.some((q) => overlaps(q, r)) &&
              !badges.some((q, j) => j !== i && overlaps(q, r));
            const show = isFocus || clear || p.classList.contains("tapped");
            p.classList.toggle("quiet", !show);
            if (show) placed.push(r);
          }
        };
        for (const p of pins)
          p.addEventListener("click", () => {
            p.classList.toggle("tapped");
            layout();
          });
        live.current = { pins, markers, layout };
        maps.Event.addListener(m, "idle", layout);

        if (pts.length > 1) {
          const bounds = new maps.LatLngBounds(pts[0], pts[0]);
          for (const p of pts) bounds.extend(p);
          // room on the right for the names
          m.fitBounds(bounds, { top: 40, right: 110, bottom: 40, left: 40 });
        }
        layout();
      })
      .catch(onFail);
    return () => {
      gone = true;
      live.current = null;
      map?.destroy();
    };
  }, [clientId, stops, route, onFail]);

  // restyle for the pair (or card) being looked at now
  const focusKey = focus.join(",");
  useEffect(() => {
    focusRef.current = focusKey ? focusKey.split(",") : [];
    live.current?.layout();
  }, [focusKey]);

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
 * Where this step's candidates are, open by default. Pins carry each card's number and colour,
 * and the places being compared right now (`focus`) stand out.
 */
export function CandidateMap(props: {
  candidates: Place[];
  indexOf: (p: Place) => number;
  focus: string[];
}) {
  const { candidates, indexOf, focus } = props;
  const clientId = useClientId();
  const [open, setOpen] = useState(true);
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
      <div className="cand-map-head">
        <span className="label">후보 위치 · {stops.length}곳</span>
        <button className="map-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? "접기" : "지도 보기"}
        </button>
      </div>
      {open && (
        <>
          <MapView clientId={clientId} stops={stops} route={false} focus={focus} onFail={fail} />
          <p className="hint cm-hint">
            핀 번호는 카드 번호와 같아 · 지금 고르는 곳이 크게 보여 · 핀을 누르면 이름
          </p>
        </>
      )}
    </div>
  );
}
