"use client";

import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

export interface MapPoint {
  id: string;
  name: string;
  lat: number;
  lng: number;
  detail?: string;
}

/**
 * Technician results on OpenStreetMap tiles (no API key). Circle
 * markers keep the bundle free of Leaflet's image assets. The results
 * list below stays the readable, no-JS source of truth; this map is
 * progressive enhancement and renders client-side only.
 */
export function TechnicianMap({
  points,
  origin,
}: {
  points: MapPoint[];
  origin: { lat: number; lng: number } | null;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) {
      return;
    }
    const reducedMotion =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const map = L.map(containerRef.current, {
      zoomAnimation: !reducedMotion,
      fadeAnimation: !reducedMotion,
    }).setView([9.06, 8.67], 5);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "© OpenStreetMap contributors",
    }).addTo(map);
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) {
      return;
    }
    const layer = L.layerGroup().addTo(map);
    const bounds: L.LatLngExpression[] = [];
    if (origin) {
      L.circleMarker([origin.lat, origin.lng], {
        radius: 8,
        color: "#22d3ee",
        weight: 2,
        fillColor: "#22d3ee",
        fillOpacity: 0.35,
      })
        .bindPopup("Your search location")
        .addTo(layer);
      bounds.push([origin.lat, origin.lng]);
    }
    for (const point of points) {
      L.circleMarker([point.lat, point.lng], {
        radius: 7,
        color: "#0ea5e9",
        weight: 2,
        fillColor: "#0ea5e9",
        fillOpacity: 0.25,
      })
        .bindPopup(
          `<strong>${escapeHtml(point.name)}</strong>${point.detail ? `<br/>${escapeHtml(point.detail)}` : ""}`,
        )
        .addTo(layer);
      bounds.push([point.lat, point.lng]);
    }
    if (bounds.length > 0) {
      map.fitBounds(L.latLngBounds(bounds), { padding: [32, 32], maxZoom: 14 });
    }
    return () => {
      layer.remove();
    };
  }, [points, origin]);

  return (
    <div
      ref={containerRef}
      role="application"
      aria-label="Map of nearby technicians"
      className="z-0 h-72 w-full overflow-hidden rounded-xl border border-edge"
    />
  );
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
