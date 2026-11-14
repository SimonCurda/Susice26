'use client';

/**
 * Interactive map (Leaflet, OSM/CARTO tiles) with layers:
 *  - LST heat grid (REAL Sentinel-3 SLSTR when CDSE creds are set, else the
 *    anchored UHI model — served by /api/lst-grid)
 *  - REAL tree-canopy raster overlay (Copernicus HRL TCD, pre-rendered PNG)
 *  - LIVE NDVI vegetation overlay (Sentinel-2 L2A via CDSE Process API,
 *    /api/copernicus/ndvi — opt-in toggle in the legend, government mode)
 *  - cool places (citizen destinations)
 *  - calculated routes (3 profiles, highlight active)
 *  - proposed planting points (government mode)
 *  - district heat-risk markers (government mode)
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import 'leaflet/dist/leaflet.css';
import { Flame, Loader2, Mountain, Satellite, Wind } from 'lucide-react';
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

interface NdviResponse {
  available: boolean;
  source: string;
  observedFrom: string;
  observedTo: string;
  bounds: { south: number; west: number; north: number; east: number };
  image: string;
  pixels: { width: number; height: number };
  /** numeric NDVI grid for hover (row-major, gridWidth values per row) */
  grid: (number | null)[];
  gridWidth: number;
  note?: string;
}

interface AirPoint {
  lat: number;
  lng: number;
  aqi: number | null;
  pm25: number | null;
  pm10: number | null;
  o3: number | null;
  no2: number | null;
}

interface AirResponse {
  available: boolean;
  source: string;
  fetchedAt: string;
  grid: AirPoint[];
  city: AirPoint | null;
  note: string;
}

interface DemResponse {
  available: boolean;
  source: string;
  bounds: { south: number; west: number; north: number; east: number };
  image: string;
  pixels: { width: number; height: number };
  /** numeric altitude grid (metres) for hover */
  grid: (number | null)[];
  gridWidth: number;
  stats: { min: number; max: number; mean: number; valleySharePct: number };
  note: string;
}

interface DlstResponse {
  available: boolean;
  source: string;
  fromYear: number;
  toYear: number;
  bounds: { south: number; west: number; north: number; east: number };
  image: string;
  pixels: { width: number; height: number };
  /** numeric Δ grid (°C) for hover — same size as the rendered raster */
  grid: (number | null)[];
  stats: {
    meanDelta: number;
    minDelta: number;
    maxDelta: number;
    shareWarmed2Pct: number;
    shareCooled2Pct: number;
    daysFrom: { date: string; mean: number }[];
    daysTo: { date: string; mean: number }[];
  };
  note: string;
}

/** Official European AQI band colour (EEA scale, 0–>100). */
function aqiColor(aqi: number | null): string {
  if (aqi === null) return '#94a3b8';
  if (aqi <= 20) return '#00b2a5';
  if (aqi <= 40) return '#71c96e';
  if (aqi <= 60) return '#e6e26e';
  if (aqi <= 80) return '#f2a65a';
  if (aqi <= 100) return '#e6674d';
  return '#a050f0';
}

function aqiLabel(aqi: number | null): string {
  if (aqi === null) return 'n/a';
  if (aqi <= 20) return 'dobrá';
  if (aqi <= 40) return 'přijatelná';
  if (aqi <= 60) return 'střední';
  if (aqi <= 80) return 'špatná';
  if (aqi <= 100) return 'velmi špatná';
  return 'extrémně špatná';
}

/** SLSTR archive summers selectable in the ΔLST picker (2016 → current year). */
const DLST_YEARS: number[] = Array.from(
  { length: Math.max(0, new Date().getFullYear() - 2016 + 1) },
  (_, i) => 2016 + i
);

/** Sample a row-major grid at a geographic coordinate — null outside/nodata. */
function sampleGrid(
  grid: (number | null)[],
  gridWidth: number,
  bounds: { south: number; west: number; north: number; east: number },
  lat: number,
  lng: number
): number | null {
  if (!grid || grid.length === 0 || !gridWidth || gridWidth < 2) return null;
  const rows = Math.floor(grid.length / gridWidth);
  if (rows < 1) return null;
  const x = Math.floor(((lng - bounds.west) / (bounds.east - bounds.west)) * gridWidth);
  const y = Math.floor(((bounds.north - lat) / (bounds.north - bounds.south)) * rows);
  if (x < 0 || y < 0 || x >= gridWidth || y >= rows) return null;
  return grid[y * gridWidth + x];
}

/** Plain-language NDVI band (mirrors the legend ramp). */
function ndviLabel(v: number): string {
  if (v >= 0.6) return 'hustá vegetace';
  if (v >= 0.4) return 'zdravá vegetace';
  if (v >= 0.2) return 'řídká vegetace';
  if (v >= 0.1) return 'stéblovina / travní pokryv';
  if (v > 0) return 'holá půda / beton';
  return 'voda / bez vegetace';
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
  /** exact A→B point picking: when active, the next map click becomes the endpoint */
  pickMode: 'start' | 'dest' | null;
  onMapPick: (lat: number, lng: number) => void;
  onPickCancel: () => void;
  startMarker: { lat: number; lng: number; name: string } | null;
  destMarker: { lat: number; lng: number; name: string } | null;
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
  const endpointLayerRef = useRef<LeafletLayerGroup | null>(null);
  const plantingLayerRef = useRef<LeafletLayerGroup | null>(null);
  const hotspotLayerRef = useRef<LeafletLayerGroup | null>(null);
  const airLayerRef = useRef<LeafletLayerGroup | null>(null);
  const demLayerRef = useRef<LeafletLayerGroup | null>(null);
  const dlstLayerRef = useRef<LeafletLayerGroup | null>(null);
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

  /**
   * LIVE NDVI overlay (Sentinel-2 via CDSE) — fetched lazily on the first
   * government-mode render; the user toggles it via the legend button.
   */
  const [ndvi, setNdvi] = useState<NdviResponse | null>(null);
  const [ndviNote, setNdviNote] = useState<string | null>(null);
  const [ndviFetched, setNdviFetched] = useState(false);
  const [showNdvi, setShowNdvi] = useState(false);
  const [ndviLoading, setNdviLoading] = useState(false);

  /** CAMS air quality layer (Copernicus via Open-Meteo) — lazy on first toggle. */
  const [air, setAir] = useState<AirResponse | null>(null);
  const [showAir, setShowAir] = useState(false);
  const [airLoading, setAirLoading] = useState(false);
  const [airNote, setAirNote] = useState<string | null>(null);

  /** Copernicus DEM terrain layer — lazy on first toggle. */
  const [dem, setDem] = useState<DemResponse | null>(null);
  const [showDem, setShowDem] = useState(false);
  const [demLoading, setDemLoading] = useState(false);
  const [demNote, setDemNote] = useState<string | null>(null);

  /** ΔLST two-summer difference layer — lazy on first toggle, refetch on year change. */
  const [dlst, setDlst] = useState<DlstResponse | null>(null);
  const [showDlst, setShowDlst] = useState(false);
  const [dlstLoading, setDlstLoading] = useState(false);
  const [dlstNote, setDlstNote] = useState<string | null>(null);
  const [dlstFrom, setDlstFrom] = useState(2018); // 2016–17 = SLSTR commissioning (calibration bias)
  const [dlstTo, setDlstTo] = useState(new Date().getFullYear());
  const [dlstKey, setDlstKey] = useState<string | null>(null);

  /**
   * Cursor readout for raster overlays (ΔLST / DEM / NDVI) and the LST grid.
   * The overlay PNGs are non-interactive images in a pane BELOW the event
   * canvas, so Leaflet tooltips never fire on them — instead the MAP-level
   * mousemove samples the numeric grids served alongside each overlay and
   * this fixed-position card follows the cursor with the exact value.
   */
  const [hoverReadout, setHoverReadout] = useState<{ text: string; x: number; y: number } | null>(null);
  const overlayRef = useRef({ showNdvi, ndvi, showDem, dem, showDlst, dlst, showLst: props.showLst, gridData });
  overlayRef.current = { showNdvi, ndvi, showDem, dem, showDlst, dlst, showLst: props.showLst, gridData };

  const loadAir = useMemo(
    () => async () => {
      if (airLoading) return;
      setAirLoading(true);
      try {
        const res = await fetch('/api/copernicus/airquality');
        const j = (await res.json().catch(() => null)) as AirResponse | null;
        if (!j) throw new Error(`GET /api/copernicus/airquality → HTTP ${res.status} ${res.statusText} (bez JSON)`);
        if (!j.available) setAirNote(j.note ?? 'kvalita vzduchu nedostupná (bez detailu)');
        else {
          setAir(j);
          setAirNote(null);
        }
      } catch (e) {
        setAirNote(e instanceof Error ? e.message : String(e));
      } finally {
        setAirLoading(false);
      }
    },
    [airLoading]
  );

  const loadDem = useMemo(
    () => async () => {
      if (demLoading) return;
      setDemLoading(true);
      try {
        const res = await fetch('/api/copernicus/dem');
        const j = (await res.json().catch(() => null)) as DemResponse | null;
        if (!j) throw new Error(`GET /api/copernicus/dem → HTTP ${res.status} ${res.statusText} (bez JSON)`);
        if (!j.available || !j.image) setDemNote(j.note ?? 'terén nedostupný (bez detailu)');
        else {
          setDem(j);
          setDemNote(null);
        }
      } catch (e) {
        setDemNote(e instanceof Error ? e.message : String(e));
      } finally {
        setDemLoading(false);
      }
    },
    [demLoading]
  );

  const loadDlst = useMemo(
    () => async (from: number, to: number) => {
      setDlstLoading(true);
      try {
        const res = await fetch(`/api/copernicus/dlst?from=${from}&to=${to}`);
        const j = (await res.json().catch(() => null)) as DlstResponse | null;
        if (!j) throw new Error(`GET /api/copernicus/dlst → HTTP ${res.status} ${res.statusText} (bez JSON)`);
        if (!j.available || !j.image) setDlstNote(j.note ?? 'ΔLST nedostupné (bez detailu)');
        else {
          setDlst(j);
          setDlstNote(null);
          setDlstKey(`${from}-${to}`);
        }
      } catch (e) {
        setDlstNote(e instanceof Error ? e.message : String(e));
      } finally {
        setDlstLoading(false);
      }
    },
    []
  );

  const toggleAir = () => {
    const next = !showAir;
    setShowAir(next);
    if (next) {
      if (airNote) setAirNote(null);
      if (!air && !airLoading) void loadAir();
    }
  };

  const toggleDem = () => {
    const next = !showDem;
    setShowDem(next);
    if (next) {
      if (demNote) setDemNote(null);
      if (!dem && !demLoading) void loadDem();
    }
  };

  // ΔLST loads/reloads whenever shown with a (from, to) pair not yet loaded
  useEffect(() => {
    if (!showDlst || dlstLoading) return;
    const key = `${dlstFrom}-${dlstTo}`;
    if (dlstKey === key) return;
    void loadDlst(dlstFrom, dlstTo);
  }, [showDlst, dlstFrom, dlstTo, dlstKey, dlstLoading, loadDlst]);

  const loadNdvi = useMemo(
    () => async () => {
      if (ndviFetched || ndviLoading) return;
      setNdviLoading(true);
      try {
        const res = await fetch('/api/copernicus/ndvi');
        const j = (await res.json().catch(() => null)) as NdviResponse | null;
        if (!j) throw new Error(`GET /api/copernicus/ndvi → HTTP ${res.status} ${res.statusText} (bez JSON)`);
        if (!j.available) {
          setNdviNote(j.note ?? 'NDVI nedostupné (bez detailu)');
        } else if (!j.image || !j.bounds) {
          setNdviNote('NDVI odpověď nemá image/bounds — overlay nelze zobrazit');
        } else {
          setNdvi(j);
          setShowNdvi(true);
          setNdviNote(null);
        }
      } catch (e) {
        setNdviNote(e instanceof Error ? e.message : String(e));
      } finally {
        setNdviFetched(true);
        setNdviLoading(false);
      }
    },
    [ndviFetched, ndviLoading]
  );

  useEffect(() => {
    if (props.showCanopy && !ndviFetched && !ndviLoading) void loadNdvi();
  }, [props.showCanopy, ndviFetched, ndviLoading, loadNdvi]);

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
      airLayerRef.current = L.layerGroup().addTo(map);
      demLayerRef.current = L.layerGroup().addTo(map);
      dlstLayerRef.current = L.layerGroup().addTo(map);
      placesLayerRef.current = L.layerGroup().addTo(map);
      routesLayerRef.current = L.layerGroup().addTo(map);
      endpointLayerRef.current = L.layerGroup().addTo(map);
      plantingLayerRef.current = L.layerGroup().addTo(map);
      hotspotLayerRef.current = L.layerGroup().addTo(map);
      // map click → exact A→B pick (only while pick mode is active; state read via cbRef)
      map.on('click', (e: { latlng: { lat: number; lng: number } }) => {
        const cb = cbRef.current;
        if (cb.pickMode && typeof cb.onMapPick === 'function') {
          cb.onMapPick(e.latlng.lat, e.latlng.lng);
        }
      });
      // cursor readout: sample the numeric grids of active raster overlays
      // (priority = DOM stacking: ΔLST above DEM above NDVI above LST model)
      map.on('mousemove', (e: { latlng: { lat: number; lng: number }; originalEvent: MouseEvent }) => {
        const o = overlayRef.current;
        const { lat, lng } = e.latlng;
        const parts: string[] = [];
        if (o.showDlst && o.dlst?.available && o.dlst.grid && o.dlst.grid.length > 0) {
          const v = sampleGrid(o.dlst.grid, o.dlst.pixels.width, o.dlst.bounds, lat, lng);
          if (v !== null) {
            parts.push(`ΔLST ${v >= 0 ? '+' : ''}${v.toFixed(1)} °C`, `léto ${o.dlst.toYear} vs. ${o.dlst.fromYear}`);
          }
        }
        if (parts.length === 0 && o.showDem && o.dem?.available && o.dem.grid && o.dem.grid.length > 0) {
          const v = sampleGrid(o.dem.grid, o.dem.gridWidth, o.dem.bounds, lat, lng);
          if (v !== null) parts.push(`Terén ≈ ${Math.round(v)} m n. m.`, 'Copernicus DEM GLO-30');
        }
        if (parts.length === 0 && o.showNdvi && o.ndvi?.grid && o.ndvi.grid.length > 0) {
          const v = sampleGrid(o.ndvi.grid, o.ndvi.gridWidth, o.ndvi.bounds, lat, lng);
          if (v !== null) parts.push(`NDVI ${v.toFixed(2)}`, ndviLabel(v));
        }
        if (parts.length === 0 && o.showLst && o.gridData?.points) {
          // nearest LST cell within half a cell diagonal — live surface temp
          let best: LstPoint | null = null;
          let bestD = Infinity;
          for (const p of o.gridData.points) {
            const d = (p.lat - lat) ** 2 + (p.lng - lng) ** 2;
            if (d < bestD) {
              bestD = d;
              best = p;
            }
          }
          if (best && bestD < 0.000012) {
            // ≈ half diagonal of the coarser grid step (0.0035/0.0055°) —
            // covers the cells AND the gaps between them, never a far-away cell
            parts.push(`LST ${best.lst.toFixed(1)} °C`, o.gridData.source === 'sentinel-3-real' ? 'Sentinel-3 SLSTR' : 'ukotvený model VRC');
          }
        }
        if (parts.length === 0) {
          setHoverReadout(null);
        } else {
          setHoverReadout({ text: parts.join(' · '), x: e.originalEvent.clientX + 14, y: e.originalEvent.clientY + 16 });
        }
      });
      map.on('mouseout', () => setHoverReadout(null));
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
    // LIVE Sentinel-2 NDVI overlay sits on top of the canopy raster when on
    if (showNdvi && ndvi?.image && ndvi?.bounds) {
      L.imageOverlay(
        ndvi.image,
        [
          [ndvi.bounds.south, ndvi.bounds.west],
          [ndvi.bounds.north, ndvi.bounds.east],
        ],
        { opacity: 0.75, interactive: false, pane: 'canopyPane' }
      ).addTo(layer);
    }
  }, [ready, props.showCanopy, showNdvi, ndvi]);

  // CAMS air quality layer — soft AQI-coloured circles on a ~1.1 km grid
  useEffect(() => {
    const L = leafletRef.current;
    const layer = airLayerRef.current;
    if (!ready || !L || !layer) return;
    layer.clearLayers();
    if (!showAir || !air?.available) return;
    const renderer = L.canvas();
    for (const p of air.grid) {
      if (p.aqi === null) continue;
      L.circleMarker([p.lat, p.lng], {
        renderer,
        radius: 17,
        fillColor: aqiColor(p.aqi),
        fillOpacity: 0.42,
        stroke: false,
      })
        .bindTooltip(
          `Evropský AQI <b>${p.aqi}</b> (${aqiLabel(p.aqi)})<br/>PM2,5 ${p.pm25 ?? '—'} · PM10 ${p.pm10 ?? '—'} · O₃ ${p.o3 ?? '—'} · NO₂ ${p.no2 ?? '—'} µg/m³`,
          { sticky: true }
        )
        .addTo(layer);
    }
  }, [ready, showAir, air]);

  // Copernicus DEM terrain overlay (shaded relief, static)
  useEffect(() => {
    const L = leafletRef.current;
    const layer = demLayerRef.current;
    if (!ready || !L || !layer) return;
    layer.clearLayers();
    if (!showDem || !dem?.available) return;
    L.imageOverlay(
      dem.image,
      [
        [dem.bounds.south, dem.bounds.west],
        [dem.bounds.north, dem.bounds.east],
      ],
      { opacity: 0.6, interactive: false, pane: 'canopyPane' }
    ).addTo(layer);
  }, [ready, showDem, dem]);

  // ΔLST two-summer difference overlay
  useEffect(() => {
    const L = leafletRef.current;
    const layer = dlstLayerRef.current;
    if (!ready || !L || !layer) return;
    layer.clearLayers();
    if (!showDlst || !dlst?.available) return;
    L.imageOverlay(
      dlst.image,
      [
        [dlst.bounds.south, dlst.bounds.west],
        [dlst.bounds.north, dlst.bounds.east],
      ],
      { opacity: 0.82, interactive: false, pane: 'canopyPane' }
    ).addTo(layer);
  }, [ready, showDlst, dlst]);

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
        .bindTooltip(
          `${r.profileName}: ${r.distanceM} m · chlad ${r.coolingScore}/100 · ${r.geometrySource === 'osrm-foot' ? 'reálné chodníky (OSM)' : 'přímé linky demo grafu (OSRM nedostupné)'}`,
          { sticky: true }
        )
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

  // pick mode: crosshair cursor + Escape cancels
  useEffect(() => {
    const container = containerRef.current;
    if (container) container.style.cursor = props.pickMode ? 'crosshair' : '';
    if (!props.pickMode) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') props.onPickCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [props.pickMode, props.onPickCancel]);

  // exact A→B endpoint markers (visible regardless of routes)
  useEffect(() => {
    const L = leafletRef.current;
    const layer = endpointLayerRef.current;
    if (!ready || !L || !layer) return;
    layer.clearLayers();
    const draw = (
      p: { lat: number; lng: number; name: string },
      role: 'start' | 'dest',
      color: string
    ) => {
      L.circleMarker([p.lat, p.lng], {
        radius: 9,
        fillColor: color,
        fillOpacity: 0.95,
        color: '#ffffff',
        weight: 3,
        dashArray: '3 3',
      })
        .bindTooltip(
          `<b>${role === 'start' ? 'Start' : 'Cíl'}: ${p.name}</b><br/><span style="font-family:monospace">${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}</span>`,
          { direction: 'top' }
        )
        .addTo(layer);
    };
    if (props.startMarker) draw(props.startMarker, 'start', '#047857');
    if (props.destMarker) draw(props.destMarker, 'dest', '#b45309');
  }, [ready, props.startMarker, props.destMarker]);

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full rounded-xl border bg-muted" role="application" aria-label="Mapa Plzně s vrstvami teploty, zeleně a tras" />
      {/* cursor readout for raster overlays + LST grid (fixed → follows the mouse) */}
      {hoverReadout ? (
        <div
          className="pointer-events-none fixed z-[700] max-w-[260px] rounded-md border bg-background/95 px-2 py-1 text-[11px] font-medium leading-tight shadow-md"
          style={{ left: hoverReadout.x, top: hoverReadout.y }}
          role="status"
        >
          {hoverReadout.text}
        </div>
      ) : null}
      {props.pickMode ? (
        <div className="pointer-events-none absolute left-1/2 top-3 z-[600] -translate-x-1/2 rounded-full border border-emerald-300 bg-emerald-700 px-4 py-1.5 text-xs font-medium text-white shadow-lg">
          Klikněte do mapy — výběr {props.pickMode === 'start' ? 'STARTU' : 'CÍLE'} · Esc zruší
        </div>
      ) : null}
      {props.showLst ? (
        <div className="pointer-events-none absolute bottom-3 left-3 z-[500] rounded-lg border bg-background/90 px-3 py-2 text-[11px] leading-4 shadow-sm backdrop-blur">
          <div className="font-medium">Teplota povrchu (LST)</div>
          <div
            className="text-[10px] text-muted-foreground"
            title={
              gridError
                ? `API selhalo, vestavěný model: ${gridError}`
                : gridData?.source === 'sentinel-3-real'
                  ? `Reálná data Sentinel-3 SLSTR — termální kanál S7 (10,85 µm), jasová teplota, posledních 72 h — ${gridData.points.length} buněk · staženo ${gridData.observedAt ? new Date(gridData.observedAt).toLocaleTimeString('cs-CZ') : '?'}`
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
      <div className="pointer-events-none absolute right-3 top-3 z-[500] flex max-h-[calc(100%-96px)] flex-col items-end space-y-2 overflow-y-auto">
        {props.showCanopy ? (
          <>
          {/* NDVI toggle + legend — clickable, opt-in live vegetation layer */}
          <div className="pointer-events-auto rounded-lg border bg-background/90 px-3 py-2 text-[11px] leading-4 shadow-sm backdrop-blur">
            <button
              type="button"
              onClick={() => setShowNdvi((v) => !v)}
              className="flex w-full items-center gap-1.5 font-medium hover:underline"
              aria-pressed={showNdvi}
              title={
                ndviNote
                  ? `NDVI: ${ndviNote}`
                  : ndvi
                    ? `Sentinel-2 L2A NDVI, přlet ${ndvi.observedFrom.slice(0, 10)} → ${ndvi.observedTo.slice(0, 10)} — klikněte pro ${showNdvi ? 'skrytí' : 'zobrazení'}`
                    : ndviLoading
                      ? 'NDVI se načítá z CDSE…'
                      : 'Živá vegetace Sentinel-2 (CDSE) — klikněte pro zobrazení'
              }
            >
              <Satellite className={`h-3.5 w-3.5 ${ndviLoading ? 'animate-pulse text-muted-foreground' : 'text-teal-600'}`} />
              Vegetace teď (NDVI)
              {ndviLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
              <span className={`ml-auto rounded px-1 text-[9px] ${showNdvi && ndvi ? 'bg-emerald-700 text-white' : 'bg-muted text-muted-foreground'}`}>
                {showNdvi && ndvi ? 'ZAP' : 'vyp'}
              </span>
            </button>
            {showNdvi && ndvi ? (
              <>
                <div className="mt-1 text-[10px] text-muted-foreground">
                  Sentinel-2 NDVI · CDSE Process API · posledních 30 dní
                </div>
                <div className="mt-1 flex h-2 w-40 overflow-hidden rounded-full">
                  {['#92513c', '#a68e55', '#c4b269', '#d3c476', '#bcc965', '#87b84d', '#55a630', '#22781e'].map((c) => (
                    <div key={c} className="flex-1" style={{ background: c }} />
                  ))}
                </div>
                <div className="mt-0.5 flex w-40 justify-between text-muted-foreground">
                  <span>vyhubení (min)</span>
                  <span>0</span>
                  <span>hustá vegetace</span>
                </div>
                <div className="mt-0.5 flex items-center gap-1 text-[9px] text-muted-foreground">
                  <span className="inline-block h-2 w-2 rounded-sm" style={{ background: '#46828c' }} /> voda · oblaky průhledné
                </div>
              </>
            ) : null}
          </div>

          <div className="rounded-lg border bg-background/90 px-3 py-2 text-[11px] leading-4 shadow-sm backdrop-blur">
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
          </>
        ) : null}

        {/* CAMS air quality — opt-in toggle (Copernicus Atmosphere Monitoring Service via Open-Meteo) */}
        <div className="pointer-events-auto rounded-lg border bg-background/90 px-3 py-2 text-[11px] leading-4 shadow-sm backdrop-blur">
          <button
            type="button"
            onClick={toggleAir}
            className="flex w-full items-center gap-1.5 font-medium hover:underline"
            aria-pressed={showAir}
            title="Kvalita vzduchu — CAMS (Copernicus) přes Open-Meteo, evropský AQI na síti ~1,1 km nad Plzní"
          >
            <Wind className={`h-3.5 w-3.5 ${airLoading ? 'animate-pulse text-muted-foreground' : 'text-teal-600'}`} />
            Kvalita vzduchu (CAMS)
            {airLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
            <span className={`ml-auto rounded px-1 text-[9px] ${showAir && air?.available ? 'bg-emerald-700 text-white' : 'bg-muted text-muted-foreground'}`}>
              {showAir && air?.available ? 'ZAP' : 'vyp'}
            </span>
          </button>
          {airNote ? (
            <div className="mt-1 max-w-[190px] font-mono text-[9px] leading-relaxed text-amber-700">{airNote}</div>
          ) : null}
          {showAir && air?.available ? (
            <>
              <div className="mt-1 max-w-[190px] text-[10px] text-muted-foreground">
                {air.city
                  ? `Plzeň střed: AQI ${air.city.aqi ?? '—'} (${aqiLabel(air.city.aqi)}) · PM2,5 ${air.city.pm25 ?? '—'} · O₃ ${air.city.o3 ?? '—'} µg/m³`
                  : 'model CAMS na síti ~1,1 km'}
              </div>
              <div className="mt-1 flex h-2 w-40 overflow-hidden rounded-full">
                {['#00b2a5', '#71c96e', '#e6e26e', '#f2a65a', '#e6674d', '#a050f0'].map((c) => (
                  <div key={c} className="flex-1" style={{ background: c }} />
                ))}
              </div>
              <div className="mt-0.5 flex w-40 justify-between text-muted-foreground">
                <span>0 dobrá</span>
                <span>100+ extrémní</span>
              </div>
              <div className="mt-0.5 max-w-[190px] text-[9px] leading-tight text-muted-foreground">
                modelová předpověď CAMS ~5 km, ne staniční měření · evropský AQI
              </div>
            </>
          ) : null}
        </div>

        {/* Copernicus DEM terrain — opt-in toggle (static shaded relief) */}
        <div className="pointer-events-auto rounded-lg border bg-background/90 px-3 py-2 text-[11px] leading-4 shadow-sm backdrop-blur">
          <button
            type="button"
            onClick={toggleDem}
            className="flex w-full items-center gap-1.5 font-medium hover:underline"
            aria-pressed={showDem}
            title="Terén — Copernicus DEM GLO-30 (30 m): stínování svahů; údolí se v noci plní studeným vzduchem"
          >
            <Mountain className={`h-3.5 w-3.5 ${demLoading ? 'animate-pulse text-muted-foreground' : 'text-stone-600'}`} />
            Terén (Copernicus DEM)
            {demLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
            <span className={`ml-auto rounded px-1 text-[9px] ${showDem && dem?.available ? 'bg-emerald-700 text-white' : 'bg-muted text-muted-foreground'}`}>
              {showDem && dem?.available ? 'ZAP' : 'vyp'}
            </span>
          </button>
          {demNote ? (
            <div className="mt-1 max-w-[190px] font-mono text-[9px] leading-relaxed text-amber-700">{demNote}</div>
          ) : null}
          {showDem && dem?.available ? (
            <>
              <div className="mt-1 max-w-[190px] text-[10px] text-muted-foreground">
                nadmořská {dem.stats.min}–{dem.stats.max} m · průměr {dem.stats.mean} m
              </div>
              <div className="mt-1 flex h-2 w-40 overflow-hidden rounded-full">
                {['#d6e2d6', '#e4e0d0', '#deccb2', '#d4bea0'].map((c) => (
                  <div key={c} className="flex-1" style={{ background: c }} />
                ))}
              </div>
              <div className="mt-0.5 flex w-40 justify-between text-muted-foreground">
                <span>údolí</span>
                <span>vrchy</span>
              </div>
              <div className="mt-0.5 max-w-[190px] text-[9px] leading-tight text-muted-foreground">
                GLO-30 · stínování svahů (slunce SZ 45°) · statický model reliéfu
              </div>
            </>
          ) : null}
        </div>

        {/* ΔLST two-summer difference — opt-in toggle with year pickers */}
        <div className="pointer-events-auto rounded-lg border bg-background/90 px-3 py-2 text-[11px] leading-4 shadow-sm backdrop-blur">
          <button
            type="button"
            onClick={() => setShowDlst((v) => !v)}
            className="flex w-full items-center gap-1.5 font-medium hover:underline"
            aria-pressed={showDlst}
            title="Rozdíl dvou let — mediana jasných horkých dnů léta (Sentinel-3 SLSTR S7), Δ = to − from"
          >
            <Flame className="h-3.5 w-3.5 text-orange-600" />
            Ohřev léta (ΔLST)
            {dlstLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
            <span className={`ml-auto rounded px-1 text-[9px] ${showDlst && dlst?.available && dlstKey === `${dlstFrom}-${dlstTo}` ? 'bg-emerald-700 text-white' : 'bg-muted text-muted-foreground'}`}>
              {showDlst && dlst?.available && dlstKey === `${dlstFrom}-${dlstTo}` ? 'ZAP' : 'vyp'}
            </span>
          </button>
          {showDlst ? (
            <>
              <div className="mt-1 flex items-center gap-1 text-[10px]">
                <select
                  value={dlstFrom}
                  onChange={(e) => setDlstFrom(Number(e.target.value))}
                  className="rounded border bg-background px-1 py-0.5"
                  aria-label="Léto A (od)"
                >
                  {DLST_YEARS.map((y) => (
                    <option key={y} value={y} disabled={y >= dlstTo}>
                      {y}
                    </option>
                  ))}
                </select>
                <span className="text-muted-foreground">vs.</span>
                <select
                  value={dlstTo}
                  onChange={(e) => setDlstTo(Number(e.target.value))}
                  className="rounded border bg-background px-1 py-0.5"
                  aria-label="Léto B (do)"
                >
                  {DLST_YEARS.map((y) => (
                    <option key={y} value={y} disabled={y <= dlstFrom}>
                      {y}
                    </option>
                  ))}
                </select>
              </div>
              {dlstLoading ? (
                <div className="mt-1 max-w-[190px] text-[10px] leading-tight text-muted-foreground">
                  spočítávám kompozity léta z CDSE (5 jasných dnů na rok) — poprvé ~30–60 s, pak je dvojice v cache…
                </div>
              ) : null}
              {dlstNote ? (
                <div className="mt-1 max-w-[190px] font-mono text-[9px] leading-relaxed text-amber-700">{dlstNote}</div>
              ) : null}
              {dlst?.available && dlstKey === `${dlstFrom}-${dlstTo}` ? (
                <>
                  <div className="mt-1 max-w-[190px] text-[10px] text-muted-foreground">
                    léto {dlst.fromYear} → {dlst.toYear}: průměr Δ {dlst.stats.meanDelta >= 0 ? '+' : ''}{dlst.stats.meanDelta} °C · ≥ +2 °C na {dlst.stats.shareWarmed2Pct} % buněk
                  </div>
                  <div className="mt-1 flex h-2 w-40 overflow-hidden rounded-full">
                    {['#0d9488', '#5fb3a4', '#b0d4cd', '#f5f5f4', '#f0c7a8', '#eb9766', '#ea580c'].map((c) => (
                      <div key={c} className="flex-1" style={{ background: c }} />
                    ))}
                  </div>
                  <div className="mt-0.5 flex w-40 justify-between text-muted-foreground">
                    <span>−4 °C chladněji</span>
                    <span>+4 °C tepleji</span>
                  </div>
                  <div className="mt-0.5 max-w-[190px] text-[9px] leading-tight text-muted-foreground">
                    mediana 5 jasných horkých dnů léta (~10:30 přlety, filtr oblaků proti ERA5) · Sentinel-3 S7
                  </div>
                </>
              ) : null}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
