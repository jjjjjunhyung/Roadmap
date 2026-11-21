import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";

import { type StepSummary, configApi } from "../lib/api";

/* The slice of Naver's map script (maps.js v3) this component uses. */
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

/** Numbered pin with the place name; built as DOM so names are never parsed as HTML. */
function pin(no: number, name: string) {
  const el = document.createElement("div");
  el.className = "cm-pin";
  const b = document.createElement("b");
  b.textContent = String(no);
  const span = document.createElement("span");
  span.textContent = name;
  el.append(b, span);
  return el;
}

/** The finished course on a Naver map: numbered pins in order, joined by a dashed line. */
export function CourseMap({ steps }: { steps: StepSummary[] }) {
  const cfg = useQuery({ queryKey: ["config"], queryFn: configApi.get, staleTime: Infinity });
  const clientId = cfg.data?.naver_map_client_id ?? null;
  const box = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const stops = useMemo(
    () =>
      steps.flatMap((s, i) =>
        s.picked && s.picked.lat !== null && s.picked.lng !== null
          ? [{ no: i + 1, name: s.picked.name, lat: s.picked.lat, lng: s.picked.lng }]
          : [],
      ),
    [steps],
  );

  useEffect(() => {
    const el = box.current;
    if (!clientId || !el || stops.length === 0) return;
    let map: NaverMap | null = null;
    let gone = false;
    window.navermap_authFailure = () => setFailed(true);
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
              icon: { content: pin(s.no, s.name), anchor: new maps.Point(13, 13) },
            }),
        );
        if (pts.length > 1) {
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
          const bounds = new maps.LatLngBounds(pts[0], pts[0]);
          for (const p of pts) bounds.extend(p);
          map.fitBounds(bounds, { top: 56, right: 72, bottom: 36, left: 36 });
        }
      })
      .catch(() => setFailed(true));
    return () => {
      gone = true;
      map?.destroy();
    };
  }, [clientId, stops]);

  if (!clientId || stops.length === 0 || failed) return null;
  return (
    <section className="course-map" aria-label="오늘의 동선 지도">
      <span className="label">오늘의 동선</span>
      <div className="cm-box" ref={box} />
    </section>
  );
}
