#!/usr/bin/env python3
"""
canopy_to_json.py — convert the raw Copernicus tree-cover GeoTIFF (10 m,
EPSG:3035, mosaic over Czechia) into the small assets the app loads:

  1) src/lib/data/canopy-plzen.json   0.001° grid (~110 m) over Plzeň city
     → imported statically by src/lib/data/canopy.ts (route edges, planting)
  2) src/lib/data/canopy-kraj.json    0.005° grid (~500 m) over Plzeňský kraj
     → imported statically by src/lib/data/canopy.ts (district green share)
  3) public/data/canopy-plzen.png     transparent map overlay rendered with the
     OFFICIAL CLMS Tree Cover Density colourmap (0 % = fully transparent, same
     as Copernicus Browser)

Every output cell = MEAN of all 10 m source pixels inside the cell (-r average),
so values are "average canopy cover %" — 0..100, rounded to integers.

Pipeline (all via GDAL command line tools):
    data/raw/<input>.tif (gigabytes, gitignored, from Google Drive)
        → gdalwarp  -t_srs EPSG:4326 -te ... -tr ... -r average   (small grid)
        → gdal_translate -of AAIGrid                              (plain text)
        → parse → JSON                                            (committed)
    … and for the PNG:
        gdalwarp -r near → gdaldem color-relief -alpha (official .clr ramp)

Usage:
    python3 scripts/canopy_to_json.py [INPUT.tif]
    (default INPUT = data/raw/user_upload.tif)

Requirements: GDAL command line tools (gdalwarp, gdal_translate, gdaldem).
    Debian/Ubuntu: sudo apt install gdal-bin
    macOS:         brew install gdal
    (syrový GeoTIFF nikdy necommitujeme — zůstává na Google Drive)
"""

from __future__ import annotations

import datetime as _dt
import json
import os
import subprocess
import sys
import tempfile

# Same region constants as src/lib/data/plzen.ts
REGION_BBOX = {"south": 48.95, "west": 12.45, "north": 50.2, "east": 13.9}
CITY_BBOX = {"south": 49.70, "west": 13.30, "north": 49.80, "east": 13.49}
CITY_STEP = 0.001   # ≈ 111 m lat × 72 m lng
KRAJ_STEP = 0.005   # ≈ 500 m

SOURCE_LABEL = (
    "Copernicus Land Monitoring Service — HRL Tree Cover Density family, "
    "10 m, EPSG:3035, mosaic over Czechia (user upload via Google Drive; "
    "product variant to be confirmed from the original zip name)"
)

# ---------------------------------------------------------------------------
# Official CLMS "Tree Cover Density" colourmap, verbatim from:
#   https://github.com/copernicus-land/colourmaps-legends
#   colourmaps/clms_vlcc_tree-cover-density/
#   clms_vlcc_tree-cover-density_europe_10m_yearly_v1.clr   (GPL-3.0 licence)
# Format = gdaldem color-relief text:  value R G B [alpha]
# Semantics: 0 % and nodata (255) are FULLY TRANSPARENT, exactly like the
# Copernicus Browser renders the layer. 1–100 = yellow → green → dark green.
# ---------------------------------------------------------------------------
TCD_RAMP_CLR = """# CLMS Tree Cover Density official colourmap (copernicus-land/colourmaps-legends, GPL-3.0)
0 240 240 240 0
1 253 255 115 255
5 239 255 115 255
10 220 255 115 255
15 201 255 115 255
20 183 255 115 255
25 164 255 115 255
30 148 250 92 255
35 130 245 69 255
40 113 240 46 255
45 97 235 23 255
50 76 230 0 255
55 71 214 19 255
60 66 199 36 255
65 66 186 50 255
70 65 171 62 255
75 70 158 74 255
80 61 145 67 255
85 52 130 59 255
90 43 117 51 255
95 36 105 44 255
100 28 92 36 255
255 0 0 0 0
"""


def run(cmd: list[str]) -> None:
    print("  $", " ".join(cmd))
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        sys.exit(f"CHYBA: příkaz selhal ({r.returncode}):\n{r.stderr[-2000:]}")


def warp_to_grid(tif: str, bbox: dict, step: float, tmpdir: str, tag: str, resample: str = "average") -> str:
    """Warp a bbox to an exact WGS84 grid; return path of the warped GeoTIFF."""
    out = os.path.join(tmpdir, f"warp_{tag}.tif")
    te = [str(bbox["west"]), str(bbox["south"]), str(bbox["east"]), str(bbox["north"])]
    run([
        "gdalwarp", "-q", "-overwrite",
        "-t_srs", "EPSG:4326",
        "-te", *te,
        "-tr", str(step), str(step),
        "-r", resample,
        "-ot", "Float32",
        "-of", "GTiff",
        tif, out,
    ])
    return out


def parse_aaigrid(path: str) -> tuple[int, int, list[float]]:
    """Read an ASCII grid → (cols, rows, values[row-major, first row = north])."""
    with open(path, "r", encoding="utf-8") as f:
        header: dict[str, float] = {}
        tokens: list[str] = []
        for line in f:
            parts = line.strip().split()
            if not parts:
                continue
            if parts[0].lower() in {"ncols", "nrows", "xllcorner", "yllcorner", "cellsize", "nodata_value"}:
                header[parts[0].lower()] = float(parts[1])
            else:
                tokens.extend(parts)
    cols, rows = int(header["ncols"]), int(header["nrows"])
    vals = [float(t) for t in tokens]
    if len(vals) != cols * rows:
        sys.exit(f"CHYBA: AAIGrid má {len(vals)} hodnot, očekáváno {cols}×{rows}={cols * rows}.")
    return cols, rows, vals


def grid_to_json(tif: str, bbox: dict, step: float, out_path: str, tmpdir: str, tag: str) -> dict:
    print(f"[{tag}] warp + parse grid …")
    warped = warp_to_grid(tif, bbox, step, tmpdir, tag)
    asc = os.path.join(tmpdir, f"{tag}.asc")
    run(["gdal_translate", "-q", "-of", "AAIGrid", warped, asc])
    cols, rows, vals = parse_aaigrid(asc)

    nodata = sum(1 for v in vals if v < 0)
    clamped = [max(0, min(100, int(round(v)))) for v in vals]

    payload = {
        "generatedAt": _dt.datetime.now(_dt.timezone.utc).isoformat(timespec="seconds"),
        "source": SOURCE_LABEL,
        "aggregation": "mean tree-canopy share per cell (0-100 %), resampled from 10 m source",
        "bbox": bbox,
        "stepDeg": step,
        "cols": cols,
        "rows": rows,
        "nodataCells": nodata,
        "values": clamped,
    }
    os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))
    kb = os.path.getsize(out_path) / 1024
    mean = sum(clamped) / len(clamped)
    zeros = sum(1 for v in clamped if v == 0)
    print(f"[{tag}] OK → {out_path} ({kb:.0f} KB, {cols}×{rows}, mean {mean:.1f} %, {zeros}× 0 %)")
    return payload


def make_png(tif: str, bbox: dict, out_path: str, tmpdir: str) -> None:
    print("[png] render transparent overlay with official CLMS TCD ramp …")
    warped = warp_to_grid(tif, bbox, 0.0001, tmpdir, "png", resample="near")  # ≈ 10 m
    ramp = os.path.join(tmpdir, "tcd_ramp.clr")
    with open(ramp, "w", encoding="utf-8") as f:
        f.write(TCD_RAMP_CLR)
    png = os.path.join(tmpdir, "canopy.png")
    run(["gdaldem", "color-relief", "-q", "-alpha", "-of", "PNG", warped, ramp, png])
    os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)
    # gdaldem may append extension; find the actual file
    if not os.path.exists(png) and os.path.exists(png + ".png"):
        png = png + ".png"
    os.replace(png, out_path)
    print(f"[png] OK → {out_path} ({os.path.getsize(out_path) / 1024:.0f} KB)")


def main() -> int:
    tif = sys.argv[1] if len(sys.argv) > 1 else os.path.join("data", "raw", "user_upload.tif")
    if not os.path.exists(tif):
        sys.exit(f"CHYBA: vstupní GeoTIFF nenalezen: {tif}\n(Syrová data stáhni z Google Drive do data/raw/ — nikdy necommituj.)")

    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    print(f"Vstup: {tif} ({os.path.getsize(tif) / 1e9:.2f} GB)")

    with tempfile.TemporaryDirectory() as tmpdir:
        grid_to_json(tif, CITY_BBOX, CITY_STEP, os.path.join(root, "src", "lib", "data", "canopy-plzen.json"), tmpdir, "city")
        grid_to_json(tif, REGION_BBOX, KRAJ_STEP, os.path.join(root, "src", "lib", "data", "canopy-kraj.json"), tmpdir, "kraj")
        make_png(tif, CITY_BBOX, os.path.join(root, "public", "data", "canopy-plzen.png"), tmpdir)

    print("=" * 72)
    print("Hotovo. Commitni tyto malé soubory:")
    print("  src/lib/data/canopy-plzen.json · src/lib/data/canopy-kraj.json")
    print("  public/data/canopy-plzen.png")
    print("Syrový GeoTIFF zůstává v data/raw/ (gitignored) nebo jen na Google Drive.")
    print("=" * 72)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
