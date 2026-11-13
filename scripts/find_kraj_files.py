#!/usr/bin/env python3
"""
find_kraj_files.py — filter a Copernicus download (281 folders etc.) down to
the files that actually cover Plzeňský kraj. No manual folder clicking.

Works on extracted folders OR still-zipped files. Pure standard library,
cross-platform (Windows PowerShell, macOS, Linux).

    python scripts/find_kraj_files.py "C:\\Users\\team\\Downloads\\copernicus"
    python3 scripts/find_kraj_files.py data/raw
    python3 scripts/find_kraj_files.py data/raw --bbox 48.95 12.45 50.2 13.9

What it does:
  1. walks the tree, reads every file/folder name,
  2. extracts 100 km tile codes (N49E013 style, used by CLMS HRL products),
  3. keeps only tiles intersecting the kraj bounding box (default:
     48.95–50.2 N, 12.45–13.9 E — the app's REGION_BBOX),
  4. also keeps country-level packages (CZ / CZE in the name, e.g. Urban
     Atlas, CORINE country files) and anything mentioning "urban atlas" for
     Czech cities,
  5. prints a short report: relevant files + total size vs. ignored + size,
     so the team knows exactly which ~handful of the 281 folders matter.
"""

from __future__ import annotations

import argparse
import os
import re
import sys

# Plzeňský kraj bounding box (matches src/lib/data/plzen.ts REGION_BBOX)
DEFAULT_BBOX = (48.95, 12.45, 50.2, 13.9)  # south, west, north, east

TILE_RE = re.compile(r"\b([NS])(\d{2,3})[ _\-]?([EW])(\d{1,3})\b", re.IGNORECASE)
# underscore is NOT treated as a boundary separator, so "cz_corine" matches too
COUNTRY_RE = re.compile(r"(?<![A-Za-z])(CZ|CZE|CZECH)(?![A-Za-z])", re.IGNORECASE)
UA_RE = re.compile(r"urban[ _\-]?atlas", re.IGNORECASE)


def lat_of(sign: str, deg: int) -> int:
    return -deg if sign.upper() == "S" else deg


def lng_of(sign: str, deg: int) -> int:
    return -deg if sign.upper() == "W" else deg


def tile_intersects_bbox(lat: int, lng: int, bbox: tuple[float, float, float, float]) -> bool:
    """A 100x100 km tile spans lat..lat+1, lng..lng+1 (tile names are corner cells)."""
    south, west, north, east = bbox
    t_s, t_n = float(lat), float(lat + 1)
    t_w, t_e = float(lng), float(lng + 1)
    return not (t_n <= south or t_s >= north or t_e <= west or t_w >= east)


def human(size: float) -> str:
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if size < 1024:
            return f"{size:.0f} {unit}" if unit != "B" else f"{int(size)} B"
        size /= 1024
    return f"{size:.1f} PB"


def scan(root: str, bbox: tuple[float, float, float, float]) -> None:
    relevant: list[tuple[str, int, str]] = []  # (path, size, reason)
    ignored: list[tuple[str, int]] = []

    for dirpath, dirnames, filenames in os.walk(root):
        for name in filenames:
            path = os.path.join(dirpath, name)
            # probe the RELATIVE path (folder + file name): a file inside a
            # tile folder inherits that tile's relevance even if its own
            # name lacks the code (e.g. N49E013/npp_tcd_100m.tif)
            probe = os.path.relpath(path, root)
            try:
                size = os.path.getsize(path)
            except OSError:
                size = 0

            m = TILE_RE.search(probe)
            if m:
                lat = lat_of(m.group(1), int(m.group(2)))
                lng = lng_of(m.group(3), int(m.group(4)))
                if tile_intersects_bbox(lat, lng, bbox):
                    relevant.append((path, size, f"tile N{lat}E{lng:03d} hits bbox"))
                    continue
            elif COUNTRY_RE.search(probe) or UA_RE.search(probe):
                relevant.append((path, size, "country/Urban-Atlas package"))
                continue
            ignored.append((path, size))

    print("=" * 72)
    print(f"RELEVANT for Plzeňský kraj ({len(relevant)} items):")
    for path, size, why in sorted(relevant, key=lambda r: -r[1]):
        print(f"  [{human(size):>9}] {path}   ← {why}")
    if not relevant:
        print("  (none — check that the names contain tile codes or CZ packages)")

    total_rel = sum(s for _, s, _ in relevant)
    total_ign = sum(s for _, s in ignored)
    print("-" * 72)
    print(f"IGNORED (outside region): {len(ignored)} items, {human(total_ign)}")
    print(f"TOTAL relevant: {human(total_rel)} of {human(total_rel + total_ign)}")
    print("=" * 72)
    print("Tip: keep the RELEVANT files (zip or tif), put them in data/raw/ and")
    print("upload everything raw to Google Drive — see README 'Drive ↔ repo ↔ Vercel'.")


def main() -> int:
    ap = argparse.ArgumentParser(description="Filter Copernicus downloads to Plzeňský kraj.")
    ap.add_argument("path", help="extracted download folder (or a parent of it)")
    ap.add_argument(
        "--bbox", nargs=4, type=float, metavar=("SOUTH", "WEST", "NORTH", "EAST"),
        default=DEFAULT_BBOX, help=f"default: {' '.join(map(str, DEFAULT_BBOX))}",
    )
    args = ap.parse_args()
    if not os.path.isdir(args.path):
        print(f"Chyba: složka neexistuje: {args.path}", file=sys.stderr)
        return 1
    scan(args.path, args.bbox)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
