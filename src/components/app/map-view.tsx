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
import { COOL_PLACES, getLstGrid, lstColor } from '@/lib/data/plzen';
import { CANOPY_OVERLAY_BOUNDS, CANOPY_OVERLAY_URL, canopyColor } from '@/lib/data/canopy';
import type { DistrictHeat, LstPoint, RouteResult } from '@/lib/engine/types';

interface AnchorInfo {
  tAir: number;
  scale: number;
  isDay: boolean;
  cloudPct: number | null;
  source: string;
  fetchedAt: string;
}

interface LstGridResponse {
  source: 'sentinel-3-real' | 'anchored-model';
  observedAt: string | null;
  anchor: AnchorInfo | null;
  points: LstPoint[];
  legendMin: number;
  legendMax: number;
  note?: string;
}

interface MapViewProps {
  showLst: boolean;
  showCanopy: boolean;
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
  const canopyLayerRef = useRef<LeafletLayerGroup | null>(null);
  const placesLayerRef = useRef<LeafletLayerGroup | null>(null);
  const routesLayerRef = useRef<LeafletLayerGroup | null>(null);
  const plantingLayerRef = useRef<LeafletLayerGroup | null>(null);
  const hotspotLayerRef = useRef<LeafletLayerGroup | null>(null);
  const cbRef = useRef(props);
  cbRef.current = props;
  const [ready, setReady] = useState(false);

  /**
   * Temperature grid served by /api/lst-grid — REAL Sentinel-3 SLSTR LST when
   * CDSE credentials are configured, otherwise the anchored UHI model (live
   * Open-Meteo measurement × transparent scale). On failure we fall back to
   * the built-in anchored grid and remember the EXACT reason (status / parse
   * error) — shown in the legend tooltip, never a generic "something went wrong".
   */
  const [gridData, setGridData] = useState<LstGridResponse | null>(null);
  const [gridError, setGridError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch('/api/lst-grid');
        if (!res.ok) {
          if (!cancelled) setGridError(`GET /api/lst-grid → HTTP ${res.status} ${res.statusText}`);
          return;
        }
        const j = (await res.json()) as Partial<LstGridResponse>;
        if (!Array.isArray(j.points) || j.points.length === 0) {
          if (!cancelled) setGridError('lst-grid: odpověď nemá pole „points“ nebo je prázdné');
          return;
        }
        const pts: LstPoint[] = [];
        for (const p of j.points as Record<string, unknown>[]) {
          const { lat, lng, lst } = p;
          if (typeof lat === 'number' && typeof lng === 'number' && typeof lst === 'number' && Number.isFinite(lst)) {
            pts.push({ lat, lng, lst });
          }
        }
        if (pts.length === 0) {
          if (!cancelled) setGridError('lst-grid: 0 platných bodů — položky musí mít čísla lat, lng, lst');
          return;
        }
        if (!cancelled) {
          setGridData({
            source: j.source === 'sentinel-3-real' ? 'sentinel-3-real' : 'anchored-model',
            observedAt: typeof j.observedAt === 'string' ? j.observedAt : null,
            anchor: (j.anchor && typeof j.anchor === 'object' ? (j.anchor as AnchorInfo) : null),
            points: pts,
            legendMin: typeof j.legendMin === 'number' ? j.legendMin : Math.floor(Math.min(...pts.map((p) => p.lst))),
            legendMax: typeof j.legendMax === 'number' ? j.legendMax : Math.ceil(Math.max(...pts.map((p) => p.lst))),
            note: typeof j.note === 'string' ? j.note : undefined,
          });
          setGridError(null);
        }
      } catch (e) {
        if (!cancelled) setGridError(`GET /api/lst-grid → ${e instanceof Error ? e.message : String(e)}`);
      }
    };
    load();
    // the anchor refreshes every 10 min (Open-Meteo cache) — follow it
    const t = setInterval(load, 15 * 60 * 1000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  // legend bounds follow the served grid (real raster or anchored model);
  // if the API failed entirely, compute them from the built-in anchored grid
  const legendBounds = useMemo(() => {
    if (gridData) return { min: gridData.legendMin, max: gridData.legendMax };
    let min = Infinity;
    let max = -Infinity;
    for (const p of getLstGrid()) {
      if (p.lst < min) min = p.lst;
      if (p.lst > max) max = p.lst;
    }
    return { min: Math.floor(min), max: Math.ceil(max) };
  }, [gridData]);

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
      // dedicated pane BELOW the overlay pane so the LST canvas rectangles
      // and routes render on top of the canopy raster overlay
      map.createPane('canopyPane');
      const pane = map.getPane('canopyPane');
      if (pane) pane.style.zIndex = '350';
      canopyLayerRef.current = L.layerGroup().addTo(map);
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

  // LST heat grid layer — served grid (real SLSTR or anchored model)
  useEffect(() => {
    const L = leafletRef.current;
    const layer = lstLayerRef.current;
    if (!ready || !L || !layer) return;
    layer.clearLayers();
    if (!props.showLst) return;
    const grid = gridData?.points ?? getLstGrid();
    // rectangle size follows the ACTIVE grid spacing (model step ≠ raster step,
    // hardcoded halves would leave gaps between raster cells)
    let halfLat = 0.00175;
    let halfLng = 0.00275;
    if (grid.length > 1) {
      const lats = [...new Set(grid.map((p) => p.lat))].sort((a, b) => a - b);
      const lngs = [...new Set(grid.map((p) => p.lng))].sort((a, b) => a - b);
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
        { stroke: false, fillColor: lstColor(p.lst, legendBounds.min, legendBounds.max), fillOpacity: 0.42 }
      )
        .bindTooltip(`Teplota povrchu: ${p.lst.toFixed(1)} °C`, { sticky: true })
        .addTo(layer);
    }
  }, [ready, props.showLst, gridData, legendBounds]);

  // REAL Copernicus tree-canopy raster overlay (pre-rendered with the official
  // CLMS TCD colourmap; 0 % is transparent, exactly like Copernicus Browser)
  useEffect(() => {
    const L = leafletRef.current;
    const layer = canopyLayerRef.current;
    if (!ready || !L || !layer) return;
    layer.clearLayers();
    if (!props.showCanopy) return;
    L.imageOverlay(CANOPY_OVERLAY_URL, CANOPY_OVERLAY_BOUNDS, {
      opacity: 0.8,
      interactive: false,
      pane: 'canopyPane',
    }).addTo(layer);
  }, [ready, props.showCanopy]);

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
        .bindTooltip(`Navržená výsadba (LST ${p.lst.toFixed(1)} °C${p.canopyPct >= 0 ? ` · korunní pokryv ${p.canopyPct} %` : ''})`, { direction: 'top' })
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
            title={
              gridError
                ? `API selhalo, vestavěný model: ${gridError}`
                : gridData?.source === 'sentinel-3-real'
                  ? `Reálná data Sentinel-3 SLSTR (clear-sky, posledních 72 h) — ${gridData.points.length} buněk`
                  : gridData?.anchor
                    ? `Model VRC ukotvený k živému měření: vzduch ${gridData.anchor.tAir.toFixed(1)} °C × škála ${gridData.anchor.scale} (sezóna/den-noc/oblaka)${gridData.note ? ` — ${gridData.note}` : ''}`
                    : 'demo vzorek — oficiální CLMS TCI škála'
            }
          >
            {gridError
              ? 'demo vzorek · oficiální CLMS TCI škála'
              : gridData?.source === 'sentinel-3-real'
                ? `reálná data Sentinel-3 · ${gridData.points.length} buněk`
                : gridData?.anchor
                  ? `ukotveno k živému měření · vzduch ${gridData.anchor.tAir.toFixed(1)} °C`
                  : 'demo vzorek · oficiální CLMS TCI škála'}
          </div>
          <div className="mt-1 flex h-2 w-40 overflow-hidden rounded-full">
            {Array.from({ length: 8 }, (_, i) => legendBounds.min + ((legendBounds.max - legendBounds.min) * i) / 7).map((t, i) => (
              <div key={i} className="flex-1" style={{ background: lstColor(t, legendBounds.min, legendBounds.max) }} />
            ))}
          </div>
          <div className="mt-0.5 flex w-40 justify-between text-muted-foreground">
            <span>{legendBounds.min} °C</span>
            <span>{legendBounds.max} °C</span>
          </div>
        </div>
      ) : null}
      {props.showCanopy ? (
        <div className="pointer-events-none absolute bottom-3 right-3 z-[500] rounded-lg border bg-background/90 px-3 py-2 text-[11px] leading-4 shadow-sm backdrop-blur">
          <div className="font-medium">Korunní pokryv stromů</div>
          <div className="text-[10px] text-muted-foreground" title="Copernicus HRL Tree Cover Density, 10 m, mozaika ČR — průměr na buňku; ověřeno proti OSM (posun < 10 m)">
            reálná data Copernicus · oficiální CLMS TCD škála
          </div>
          <div className="mt-1 flex h-2 w-40 overflow-hidden rounded-full">
            {[2, 15, 30, 45, 60, 75, 90, 100].map((v) => (
              <div key={v} className="flex-1" style={{ background: canopyColor(v) }} />
            ))}
          </div>
          <div className="mt-0.5 flex w-40 justify-between text-muted-foreground">
            <span>0 % (průhledné)</span>
            <span>100 %</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
