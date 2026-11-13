'use client';

/**
 * Interactive map (Leaflet, OSM/CARTO tiles) with layers:
 *  - LST heat grid (Copernicus-methodology demo raster)
 *  - cool places (citizen destinations)
 *  - calculated routes (3 profiles, highlight active)
 *  - proposed planting points (government mode)
 *  - district heat-risk markers (government mode)
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import 'leaflet/dist/leaflet.css';
import type { LayerGroup as LeafletLayerGroup, Map as LeafletMap } from 'leaflet';
import { COOL_PLACES, getLstGrid, LST_LEGEND_MAX, LST_LEGEND_MIN, lstColor } from '@/lib/data/plzen';
import type { DistrictHeat, LstPoint, RouteResult } from '@/lib/engine/types';

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

  /**
   * Real raster grid (scripts/raster_to_grid.py → public/data/lst-grid.json).
   * If the file is not deployed yet, we fall back to the deterministic demo
   * grid and remember the EXACT reason (status / parse error) — shown in the
   * legend tooltip, never a generic "something went wrong".
   */
  const [realGrid, setRealGrid] = useState<LstPoint[] | null>(null);
  const [gridError, setGridError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/data/lst-grid.json');
        if (!res.ok) {
          setGridError(`GET /data/lst-grid.json → HTTP ${res.status} ${res.statusText}`);
          return;
        }
        const j: unknown = await res.json();
        const raw: unknown[] | undefined = Array.isArray(j) ? j : (j as { points?: unknown[] })?.points;
        if (!Array.isArray(raw) || raw.length === 0) {
          setGridError('lst-grid.json: chybí pole „points“ nebo je prázdné');
          return;
        }
        const pts: LstPoint[] = [];
        for (const p of raw as Record<string, unknown>[]) {
          const lat = p.lat;
          const lng = p.lng;
          const lst = p.lst;
          if (typeof lat === 'number' && typeof lng === 'number' && typeof lst === 'number' && Number.isFinite(lst)) {
            pts.push({ lat, lng, lst });
          }
        }
        if (pts.length === 0) {
          setGridError(`lst-grid.json: 0 platných bodů z ${raw.length} — položky musí mít čísla lat, lng, lst`);
          return;
        }
        if (!cancelled) setRealGrid(pts);
      } catch (e) {
        setGridError(`GET /data/lst-grid.json → ${e instanceof Error ? e.message : String(e)}`);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // legend bounds follow the loaded data (real raster) or the known demo domain
  const legendBounds = useMemo(() => {
    if (!realGrid) return { min: LST_LEGEND_MIN, max: LST_LEGEND_MAX };
    let min = Infinity;
    let max = -Infinity;
    for (const p of realGrid) {
      if (p.lst < min) min = p.lst;
      if (p.lst > max) max = p.lst;
    }
    return { min: Math.floor(min), max: Math.ceil(max) };
  }, [realGrid]);

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

  // LST heat grid layer — real raster when deployed, demo sample otherwise
  useEffect(() => {
    const L = leafletRef.current;
    const layer = lstLayerRef.current;
    if (!ready || !L || !layer) return;
    layer.clearLayers();
    if (!props.showLst) return;
    const grid = realGrid ?? getLstGrid();
    // rectangle size follows the REAL grid spacing (demo step ≠ raster step,
    // hardcoded halves would leave gaps between raster cells)
    let halfLat = 0.00175;
    let halfLng = 0.00275;
    if (realGrid && realGrid.length > 1) {
      const lats = [...new Set(realGrid.map((p) => p.lat))].sort((a, b) => a - b);
      const lngs = [...new Set(realGrid.map((p) => p.lng))].sort((a, b) => a - b);
      let dLat = Infinity;
      for (let i = 1; i < lats.length; i++) dLat = Math.min(dLat, lats[i] - lats[i - 1]);
      let dLng = Infinity;
      for (let i = 1; i < lngs.length; i++) dLng = Math.min(dLng, lngs[i] - lngs[i - 1]);
      if (Number.isFinite(dLat) && dLat > 0) halfLat = dLat / 2;
      if (Number.isFinite(dLng) && dLng > 0) halfLng = dLng / 2;
    }
    for (const p of grid) {
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
  }, [ready, props.showLst, realGrid]);

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
          <div
            className="text-[10px] text-muted-foreground"
            title={realGrid
              ? `Reálný raster: ${realGrid.length} bodů z public/data/lst-grid.json`
              : `Demo vzorek — real data zatím nejsou nasazené${gridError ? ` (${gridError})` : ''}`}
          >
            {realGrid
              ? `reálná data · ${realGrid.length} bodů z rasteru`
              : 'demo vzorek · oficiální CLMS TCI škála'}
          </div>
          <div className="mt-1 flex h-2 w-40 overflow-hidden rounded-full">
            {Array.from({ length: 8 }, (_, i) => legendBounds.min + ((legendBounds.max - legendBounds.min) * i) / 7).map((t, i) => (
              <div key={i} className="flex-1" style={{ background: lstColor(t) }} />
            ))}
          </div>
          <div className="mt-0.5 flex w-40 justify-between text-muted-foreground">
            <span>{legendBounds.min} °C</span>
            <span>{legendBounds.max} °C</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
