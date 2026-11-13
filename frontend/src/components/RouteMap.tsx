import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { getMapPoints } from "../api/mapPoints";
import type { TripPackage } from "../api/endpoints";
import { useI18n } from "../i18n/I18nProvider";
import { buildRoute, type MapPoints, type RouteLeg, type Stop } from "../lib/route";
import Icon from "./Icon";
import "./RouteMap.css";

/**
 * Map tiles from OpenStreetMap: free, no key or account. Their licence asks for the credit below.
 * https://operations.osmfoundation.org/policies/tiles/
 */
const TILES = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const CREDIT = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

function useMapPoints(): MapPoints | null {
  const [points, setPoints] = useState<MapPoints | null>(null);
  useEffect(() => {
    let live = true;
    getMapPoints().then((p) => live && setPoints(p), () => undefined);
    return () => { live = false; };
  }, []);
  return points;
}

const pinIcon = (stop: Stop) =>
  stop.kind === "attraction"
    ? String(stop.visit ?? "")
    : renderToStaticMarkup(<Icon name={stop.kind === "airport" ? "flight" : "hotel"} />);

/** The Leaflet map itself: one line per leg (flights dashed) and one pin per place. */
function MapCanvas({ stops, legs, label }: { stops: Stop[]; legs: RouteLeg[]; label: string }) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<{ map: L.Map; layer: L.LayerGroup } | null>(null);

  useEffect(() => {
    if (!box.current) return;
    const m = L.map(box.current, { scrollWheelZoom: false });
    m.attributionControl.setPrefix(false);
    L.tileLayer(TILES, { attribution: CREDIT, maxZoom: 18 }).addTo(m);
    map.current = { map: m, layer: L.layerGroup().addTo(m) };
    return () => {
      m.remove();
      map.current = null;
    };
  }, []);

  useEffect(() => {
    const current = map.current;
    if (!current || !stops.length) return;
    current.layer.clearLayers();
    for (const leg of legs) {
      L.polyline(
        [[leg.from.lat, leg.from.lng], [leg.to.lat, leg.to.lng]],
        { className: leg.mode === "flight" ? "route-map__leg route-map__leg--flight" : "route-map__leg" },
      ).addTo(current.layer);
    }
    const seen = new Set<string>();
    for (const stop of stops) {
      if (seen.has(stop.key)) continue;
      seen.add(stop.key);
      const tip = document.createElement("span");
      tip.textContent = stop.name;
      L.marker([stop.lat, stop.lng], {
        title: stop.name,
        alt: stop.name,
        icon: L.divIcon({
          className: `route-map__pin route-map__pin--${stop.kind}`,
          html: pinIcon(stop),
          iconSize: [28, 28],
          iconAnchor: [14, 14],
        }),
      }).bindTooltip(tip).addTo(current.layer);
    }
    current.map.fitBounds(L.latLngBounds(stops.map((s) => [s.lat, s.lng] as [number, number])), {
      padding: [32, 32],
      maxZoom: 14,
    });
  }, [stops, legs]);

  return <div ref={box} className="route-map__canvas" role="region" aria-label={label} />;
}

/** The whole route of a package on a map, with a list of the stops and a pick of one day. */
export default function RouteMap({ pkg }: { pkg: TripPackage }) {
  const { t, dayLabel } = useI18n();
  const points = useMapPoints();
  const route = useMemo(() => (points ? buildRoute(pkg, points) : null), [pkg, points]);
  const [day, setDay] = useState<string | null>(null);
  const headingId = useId();

  if (!route || !route.stops.length) return null;
  const shown = (day && route.days.find((d) => d.date === day)) || route;
  const kindLabel = (stop: Stop) =>
    stop.kind === "attraction" ? t("map.visit", { n: stop.visit ?? "" }) : t(`map.${stop.kind}`);

  return (
    <section className="route-map card" aria-labelledby={headingId}>
      <h2 id={headingId} className="route-map__title">
        <Icon name="pin" /> {t("map.title")}
      </h2>
      <div className="route-map__days" role="group" aria-label={t("map.pickDay")}>
        <button type="button" className="route-map__day" aria-pressed={!day} onClick={() => setDay(null)}>
          {t("map.wholeTrip")}
        </button>
        {route.days.map((d) => (
          <button
            key={d.date}
            type="button"
            className="route-map__day"
            aria-pressed={day === d.date}
            onClick={() => setDay(d.date)}
          >
            {dayLabel(d.date)}
          </button>
        ))}
      </div>
      <div className="route-map__body">
        <MapCanvas stops={shown.stops} legs={shown.legs} label={t("map.aria")} />
        <div className="route-map__side">
          <ol className="route-map__stops" aria-label={t("map.stops")}>
            {shown.stops.map((stop, i) => (
              <li key={`${stop.key}-${i}`} className={`route-map__stop route-map__stop--${stop.kind}`}>
                <span className={`route-map__pin route-map__pin--${stop.kind}`} aria-hidden="true">
                  {stop.kind === "attraction" ? stop.visit : <Icon name={stop.kind === "airport" ? "flight" : "hotel"} />}
                </span>
                <span className="route-map__stop-text">
                  <span className="route-map__stop-name">{stop.name}</span>
                  <span className="route-map__stop-kind">{kindLabel(stop)}</span>
                </span>
              </li>
            ))}
          </ol>
          <p className="route-map__key">
            <span className="route-map__swatch" aria-hidden="true" /> {t("map.ground")}
            <span className="route-map__swatch route-map__swatch--flight" aria-hidden="true" /> {t("map.flight")}
          </p>
        </div>
      </div>
    </section>
  );
}
