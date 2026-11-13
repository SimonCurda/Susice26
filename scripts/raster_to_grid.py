#!/usr/bin/env python3
"""
raster_to_grid.py — convert raw Copernicus GeoTIFF(s) into the small JSON grid
the app loads from public/data/lst-grid.json.

This is the "processing" arrow in the README diagram:
    data/raw/*.tif  (gigabytes, gitignored, from Google Drive)
        →  python scripts/raster_to_grid.py data/raw/*.tif --kelvin --out public/data/lst-grid.json
        →  public/data/lst-grid.json  (kilobytes → committed → Vercel CDN)

Handles the usual CLMS quirks for you:
  - input CRS is auto-detected (CLMS rasters are often EPSG:3035; we transform
    the output grid into the raster CRS before sampling),
  - nodata pixels are skipped,
  - Kelvin or scaled-integer values are converted (--kelvin / --scale --offset),
  - multiple inputs are averaged per cell (mosaic of neighbouring tiles),
  - if the output would be too heavy for the browser, it is uniformly
    subsampled to --max-points and the JSON meta records it.

Examples:
  # Sentinel-3 SLSTR LST in Kelvin -> °C
  python scripts/raster_to_grid.py data/raw/lst_tiles/*.tif --kelvin \
      --value-name lst --out public/data/lst-grid.json

  # Sentinel-2 NDVI stored as int16 × 0.0001
  python scripts/raster_to_grid.py data/raw/ndvi.tif --scale 0.0001 \
      --value-name ndvi --out public/data/ndvi-grid.json

  # HRL Tree Cover Density 0-100 (already correct, just rename the field)
  python scripts/raster_to_grid.py data/raw/tcd.tif --value-name tcd \
      --out public/data/tcd-grid.json
"""

from __future__ import annotations

import argparse
import datetime as _dt
import json
import sys

try:
    import numpy as np
    import rasterio
    from rasterio.warp import transform as warp_transform
except ImportError as e:
    sys.exit(
        f"Chybí knihovna: {e.name}. Nainstaluj ji příkazem:\n"
        "    pip install rasterio numpy\n"
        "(na Windows stačí obyčejný pip — wheel existuje; neinstaluj GDAL ručně)"
    )

# Plzeňský kraj — same as src/lib/data/plzen.ts REGION_BBOX
DEFAULT_BBOX = (48.95, 12.45, 50.2, 13.9)  # south, west, north, east


def build_grid(south: float, west: float, north: float, east: float, step: float):
    lats = np.arange(south, north, step)
    lngs = np.arange(west, east, step)
    lat_g, lng_g = np.meshgrid(lats, lngs, indexing="ij")
    return lat_g.ravel(), lng_g.ravel()


def sample_rasters(paths: list[str], lat: np.ndarray, lng: np.ndarray) -> np.ndarray:
    """Sample all rasters at the given lat/lng cell centers; average non-nodata."""
    vals_sum = np.zeros(lat.shape, dtype=np.float64)
    vals_cnt = np.zeros(lat.shape, dtype=np.int32)

    for path in paths:
        with rasterio.open(path) as src:
            # transform cell centers from WGS84 into the raster's own CRS
            xs, ys = warp_transform("EPSG:4326", src.crs, lng.tolist(), lat.tolist())
            samples = src.sample(zip(xs, ys), indexes=1, masked=True)
            for i, v in enumerate(samples):
                if v is not None and not np.ma.is_masked(v) and np.isfinite(float(v)):
                    vals_sum[i] += float(v)
                    vals_cnt[i] += 1
        print(f"  vzorkováno: {path} (CRS {src.crs}, rozsah {src.bounds})")

    out = np.full(lat.shape, np.nan)
    ok = vals_cnt > 0
    out[ok] = vals_sum[ok] / vals_cnt[ok]
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description="GeoTIFF → app grid JSON (Plzeňský kraj).")
    ap.add_argument("inputs", nargs="+", help="GeoTIFF soubory (rastery z Copernicus)")
    ap.add_argument("--out", required=True, help="výstupní JSON, např. public/data/lst-grid.json")
    ap.add_argument("--bbox", nargs=4, type=float, metavar=("SOUTH", "WEST", "NORTH", "EAST"),
                    default=DEFAULT_BBOX, help=f"default: {' '.join(map(str, DEFAULT_BBOX))}")
    ap.add_argument("--step", type=float, default=0.005, help="krok gridu ve stupních (0.005 ≈ 500 m)")
    ap.add_argument("--kelvin", action="store_true", help="vstup je v Kelvinech → převede na °C (−273.15)")
    ap.add_argument("--scale", type=float, default=1.0, help="násobek (např. NDVI int16 × 0.0001)")
    ap.add_argument("--offset", type=float, default=0.0, help="posun po násobení")
    ap.add_argument("--value-name", default="lst", help="název hodnoty v JSON (lst | ndvi | tcd …)")
    ap.add_argument("--max-points", type=int, default=12000,
                    help="tvrdý strop bodů pro Leaflet (překročení → rovnoměrný výběr)")
    args = ap.parse_args()

    for p in args.inputs:
        if not (p.endswith(".tif") or p.endswith(".tiff") or p.endswith(".tif.msk") or ".tif" in p):
            print(f"VAROVÁNÍ: {p} nevypadá jako GeoTIFF (očekávám .tif). JPG/PNG jsou jen náhledy — nejsou data.")

    lat, lng = build_grid(*args.bbox, args.step)
    print(f"Grid: {len(lat)} buněk (bbox {args.bbox}, krok {args.step}°)")

    values = sample_rasters(args.inputs, lat, lng)

    if args.kelvin:
        values = values - 273.15
    values = values * args.scale + args.offset

    valid = np.isfinite(values)
    skipped = int((~valid).sum())
    lat_v, lng_v, val_v = lat[valid], lng[valid], values[valid]

    if len(val_v) == 0:
        sys.exit(
            "CHYBA: žádná platná data v bbox. Možné příčiny: raster nepokrývá Plzeňský kraj "
            "(zkontroluj tile v názvu souboru), jiná proměnná v 1. pásmu, nebo nodata v celé scéně."
        )

    # subsample if too heavy for Leaflet
    subsampled = False
    if len(val_v) > args.max_points:
        stride = int(np.ceil(len(val_v) / args.max_points))
        lat_v, lng_v, val_v = lat_v[::stride], lng_v[::stride], val_v[::stride]
        subsampled = True

    points = [
        {"lat": round(float(a), 5), "lng": round(float(o), 5), args.value_name: round(float(v), 1)}
        for a, o, v in zip(lat_v, lng_v, val_v)
    ]

    payload = {
        "generatedAt": _dt.datetime.now(_dt.timezone.utc).isoformat(timespec="seconds"),
        "sourceFiles": args.inputs,
        "bbox": {"south": args.bbox[0], "west": args.bbox[1], "north": args.bbox[2], "east": args.bbox[3]},
        "stepDeg": args.step,
        "valueName": args.value_name,
        "conversions": {"kelvin": args.kelvin, "scale": args.scale, "offset": args.offset},
        "cellsSampled": int(valid.sum()) + skipped,
        "cellsNodata": skipped,
        "points": len(points),
        "subsampled": subsampled,
    }
    meta = dict(payload)
    meta["points"] = points  # keep summary keys + full array under "points"
    payload_json = {**meta, "points": points}

    import os
    os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(payload_json, f, ensure_ascii=False)

    kb = os.path.getsize(args.out) / 1024
    print("=" * 72)
    print(f"OK → {args.out} ({kb:.0f} KB, {len(points)} bodů"
          f"{', subsampled' if subsampled else ''})")
    print(f"Hodnoty: min {val_v.min():.1f} · mean {val_v.mean():.1f} · max {val_v.max():.1f} "
          f"(nodata přeskočeno: {skipped})")
    print("Commitni tento JSON (kilobajty OK), syrová data zůstávají na Drive.")
    print("=" * 72)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
