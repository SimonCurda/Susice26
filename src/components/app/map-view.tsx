'use client';

/**
 * Interactive map (Leaflet, OSM/CARTO tiles) with layers:
 *  - LST heat grid (Copernicus-methodology demo raster)
 *  - cool places (citizen destinations)
 *  - calculated routes (3 profiles, highlight active)
 *  - proposed planting points (government mode)
 *  - district heat-risk markers (government mode)
 */

import { useEffect, useRef, useState } from 'react';
import 'leaflet/dist/leaflet.css';
import type { LayerGroup as LeafletLayerGroup, Map as LeafletMap } from 'leaflet';
import { COOL_PLACES, getLstGrid, lstColor } from '@/lib/data/plzen';
import type { DistrictHeat, RouteResult } from '@/lib/engine/types';

interface MapViewProps {
  showLst: boolean;
  showPlaces: boolean;
  showHotspots: boolean;
  hotspots: DistrictHeat[];
  routes: RouteResult[];
  activeRouteIdx: number;
  onSelectRoute: (idx: number) => void;
  plantingPoints: { lat: number; lng: number; lst: number }[];
  onHotspotClick: (id: string) => void;
  focus: { lat: number; lng: number; zoom?: number; key: number } | null;
}

function riskColor(risk: number): string {
  if (risk < 30) return '#059669';
  if (risk < 45) return '#d97706';
  if (risk < 60) return '#ea580c';
  return '#dc2626';
}

const PLACE_COLORS: Record<string, string> = {
  park: '#059669',
  water: '#0d9488',
  forest: '#065f46',
  fountain: '#14b8a6',
  square: '#d97706',
  pool: '#0d9488',
};

export default function MapView(props: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const leafletRef = useRef<typeof import('leaflet') | null>(null);
  const lstLayerRef = useRef<LeafletLayerGroup | null>(null);
  const placesLayerRef = useRef<LeafletLayerGroup | null>(null);
  const routesLayerRef = useRef<LeafletLayerGroup | null>(null);
  const plantingLayerRef = useRef<LeafletLayerGroup | null>(null);
  const hotspotLayerRef = useRef<LeafletLayerGroup | null>(null);
  const cbRef = useRef(props);
  cbRef.current = props;
  const [ready, setReady] = useState(false);

  // init map once
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = await import('leaflet');
      if (cancelled || !containerRef.current || mapRef.current) return;
      const map = L.map(containerRef.current, {
        preferCanvas: true,
        zoomControl: true,
        scrollWheelZoom: true,
      }).setView([49.7477, 13.3776], 12.5);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 19,
      }).addTo(map);
      mapRef.current = map;
      leafletRef.current = L;
      lstLayerRef.current = L.layerGroup().addTo(map);
      placesLayerRef.current = L.layerGroup().addTo(map);
      routesLayerRef.current = L.layerGroup().addTo(map);
      plantingLayerRef.current = L.layerGroup().addTo(map);
      hotspotLayerRef.current = L.layerGroup().addTo(map);
      setReady(true);
    })();
    return () => {
      cancelled = true;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
        setReady(false);
      }
    };
  }, []);

  // LST heat grid layer
  useEffect(() => {
    const L = leafletRef.current;
    const layer = lstLayerRef.current;
    if (!ready || !L || !layer) return;
    layer.clearLayers();
    if (!props.showLst) return;
    for (const p of getLstGrid()) {
      const halfLat = 0.00175;
      const halfLng = 0.00275;
      L.rectangle(
        [
          [p.lat - halfLat, p.lng - halfLng],
          [p.lat + halfLat, p.lng + halfLng],
        ],
        { stroke: false, fillColor: lstColor(p.lst), fillOpacity: 0.42 }
      )
        .bindTooltip(`Teplota povrchu: ${p.lst.toFixed(1)} °C`, { sticky: true })
        .addTo(layer);
    }
  }, [ready, props.showLst]);

  // cool places layer
  useEffect(() => {
    const L = leafletRef.current;
    const layer = placesLayerRef.current;
    if (!ready || !L || !layer) return;
    layer.clearLayers();
    if (!props.showPlaces) return;
    for (const p of COOL_PLACES) {
      L.circleMarker([p.lat, p.lng], {
        radius: 8,
        fillColor: PLACE_COLORS[p.type] ?? '#0d9488',
        fillOpacity: 0.95,
        color: '#ffffff',
        weight: 2,
      })
        .bindTooltip(`<b>${p.name}</b><br/>${p.description}<br/>O cca ${p.tempOffset.toFixed(1)} °C chladnější`, { direction: 'top' })
        .addTo(layer);
    }
  }, [ready, props.showPlaces]);

  // routes layer
  useEffect(() => {
    const L = leafletRef.current;
    const layer = routesLayerRef.current;
    if (!ready || !L || !layer) return;
    layer.clearLayers();
    props.routes.forEach((r, idx) => {
      const active = idx === props.activeRouteIdx;
      const poly = L.polyline(
        r.geometry.map((g) => [g.lat, g.lng] as [number, number]),
        {
          color: r.color,
          weight: active ? 7 : 4,
          opacity: active ? 0.95 : 0.45,
          lineCap: 'round',
          dashArray: r.profileId === 'fastest' ? '8 8' : undefined,
        }
      )
        .bindTooltip(`${r.profileName}: ${r.distanceM} m · chlad ${r.coolingScore}/100`, { sticky: true })
        .on('click', () => cbRef.current.onSelectRoute(idx))
        .addTo(layer);
      poly.bringToFront();
    });
  }, [ready, props.routes, props.activeRouteIdx]);

  // planting points layer
  useEffect(() => {
    const L = leafletRef.current;
    const layer = plantingLayerRef.current;
    if (!ready || !L || !layer) return;
    layer.clearLayers();
    if (props.plantingPoints.length === 0) return;
    for (const p of props.plantingPoints) {
      L.circleMarker([p.lat, p.lng], {
        radius: 6,
        fillColor: '#dc2626',
        fillOpacity: 0.9,
        color: '#ffffff',
        weight: 1.5,
      })
        .bindTooltip(`Navržená výsadba (LST ${p.lst.toFixed(1)} °C)`, { direction: 'top' })
        .addTo(layer);
    }
  }, [ready, props.plantingPoints]);

  // hotspot markers layer (government)
  useEffect(() => {
    const L = leafletRef.current;
    const layer = hotspotLayerRef.current;
    if (!ready || !L || !layer) return;
    layer.clearLayers();
    if (!props.showHotspots) return;
    for (const h of props.hotspots) {
      L.circleMarker([h.district.lat, h.district.lng], {
        radius: 6 + Math.sqrt(h.district.population) / 55,
        fillColor: riskColor(h.heatRisk),
        fillOpacity: 0.85,
        color: '#ffffff',
        weight: 2,
      })
        .bindTooltip(`<b>${h.district.name}</b><br/>Riziko: ${h.heatRisk}/100 · LST ${h.lstAvg} °C · zeleň ${h.greenPct} %`, { direction: 'top' })
        .on('click', () => cbRef.current.onHotspotClick(h.district.id))
        .addTo(layer);
    }
  }, [ready, props.showHotspots, props.hotspots]);

  // fly to focus target
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !props.focus) return;
    map.flyTo([props.focus.lat, props.focus.lng], props.focus.zoom ?? 14, { duration: 0.9 });
  }, [ready, props.focus]);

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full rounded-xl border bg-muted" role="application" aria-label="Mapa Plzně s vrstvami teploty, zeleně a tras" />
      {props.showLst ? (
        <div className="pointer-events-none absolute bottom-3 left-3 z-[500] rounded-lg border bg-background/90 px-3 py-2 text-[11px] leading-4 shadow-sm backdrop-blur">
          <div className="font-medium">Teplota povrchu (LST)</div>
          <div className="mt-1 flex h-2 w-40 overflow-hidden rounded-full">
            {[21, 24, 26, 28, 30, 32, 34, 38].map((t, i) => (
              <div key={i} className="flex-1" style={{ background: lstColor(t) }} />
            ))}
          </div>
          <div className="mt-0.5 flex w-40 justify-between text-muted-foreground">
            <span>21 °C</span>
            <span>38 °C</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
