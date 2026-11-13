# SETUP — from Copernicus download to the deployed app

Complete path: **281 zipped folders → Google Drive → local processing → small JSON in the repo → Vercel.**
Every command is copy-paste. Estimated total time: ~1.5 h (mostly upload).

Golden rules (why the setup looks like this):

1. **Raw data never enters git.** GitHub rejects files > 100 MB and Vercel's serverless
   filesystem is read-only. Raw stays on Google Drive + `data/raw/` (gitignored).
2. **Only small processed JSON (kilobytes) gets committed.** Vercel reads ONLY the repo.
3. **The app never talks to Google Drive at runtime.** No direct Drive→Vercel connection exists;
   the bridge is: rclone (Drive→laptop) and git push (laptop→repo→Vercel).
4. **No generic errors anywhere** — every script and endpoint tells you exactly what failed.

---

## Step 0 — one-time tool installation (~10 min)

Each team member needs once:

| Tool | Windows | macOS/Linux | Check |
|---|---|---|---|
| Python 3.10+ | python.org installer, tick "Add to PATH" | usually preinstalled | `python --version` |
| rclone | `winget install Rclone.Rclone` | `brew install rclone` / `apt install rclone` | `rclone version` |
| Git | git-scm.com | preinstalled | `git --version` |
| Bun (dev only) | `powershell -c "irm bun.sh/install.ps1 \| iex"` | `curl -fsSL https://bun.sh/install \| bash` | `bun --version` |
| QGIS (optional) | qgis.org — only to visually verify rasters | | |

For the processing step (Step 4): `pip install rasterio numpy` (normal pip works on Windows; do NOT install GDAL manually — rasterio ships wheels).

## Step 1 — find out what you actually downloaded (5 min)

```powershell
# anywhere on your machine — point it at the EXTRACTED download folder
python scripts/find_kraj_files.py "C:\Users\you\Downloads\copernicus"
```

It prints which files cover Plzeňský kraj (100 km tiles like `N49E013`, CZ packages,
Urban Atlas) and ignores the rest — no clicking through 281 folders.

Then check the extension of the extracted files:

- **`.tif` (tens/hundreds of MB)** = GeoTIFF = the actual data. This is what you want.
- `.jpg` / `.png` (few hundred KB) = official preview/thumbnail only → re-download the raster.
- A typical package = `.tif` + `.tif.msk` (validity mask) + preview + metadata XML. Normal.

Optional but recommended: drag the `.tif` into QGIS — it should land exactly on Plzeňský kraj.

## Step 2 — upload the raw ZIPs to Google Drive (~30–60 min, once)

Keep the ZIPs **zipped**. Configure rclone once (any machine):

```bash
rclone config
#   n                (new remote)
#   name: gdrive
#   storage: drive
#   client_id / client_secret / scope / ... : press Enter for all defaults
#   auto config → browser opens → log into the Google account that owns the Drive
```

Upload everything (one command, resumable — rerun if interrupted):

```bash
rclone copy "C:\Users\you\Downloads\copernicus-zips" gdrive:Hackathon-Data/raw --progress
```

Then share the Drive folder `Hackathon-Data` with your teammates (Editor rights) —
uploading happens exactly once, nobody does it again.

## Step 3 — every teammate pulls the project + data (5 min)

```bash
git clone https://github.com/SimonCurda/Susice26.git
cd Susice26
bun install

# pull the raw data from Drive into data/raw/ (gitignored)
rclone config          # same as Step 2, using YOUR google account
./scripts/pull-from-drive.sh                    # Git Bash on Windows: sh scripts/pull-from-drive.sh
```

No manual folder checking — rclone copies the whole subtree.

## Step 4 — process raw raster → app data (5 min)

The converter handles CLMS quirks (CRS auto-detect incl. EPSG:3035, nodata, mosaics of
several tiles, Kelvin → °C, scaled ints, browser-size subsampling):

```bash
# LST (Sentinel-3 SLSTR, Kelvin) → the app's heat layer
python scripts/raster_to_grid.py data/raw/your_tiles/*.tif --kelvin --out public/data/lst-grid.json

# NDVI (Sentinel-2, int16 × 0.0001) → vegetation layer
python scripts/raster_to_grid.py data/raw/ndvi.tif --scale 0.0001 --value-name ndvi --out public/data/ndvi-grid.json

# Tree Cover Density 0–100 → shading factor
python scripts/raster_to_grid.py data/raw/tcd.tif --value-name tcd --out public/data/tcd-grid.json
```

Notes:
- `--value-name lst` is required for the heat-layer file (`lst-grid.json`); the app reads `{lat, lng, lst}`.
- Point the `--bbox` at Plzeň city for the city overlay (default is the whole kraj).
- If output > ~12 000 points the script subsamples automatically and tells you so.
- The script prints exact stats (min/mean/max, nodata count, source CRS) — sanity-check them.

**Verify the result in the app:**

```bash
bun run dev      # http://localhost:3000
```

Switch to **Samospráva** mode. The legend under the map now says
`reálná data · N bodů z rasteru` instead of `demo vzorek`.

## Step 5 — commit the small JSON, push, deploy

```bash
git add public/data/lst-grid.json     # kilobytes — safe and correct to commit
git commit -m "Real LST raster: Plzeň grid from Sentinel-3 SLSTR"
git push
```

Deploy (once, ~3 minutes): [vercel.com/new](https://vercel.com/new) → import `SimonCurda/Susice26`
→ Framework preset Next.js (auto) → no env vars → Deploy. Every future `git push` redeploys automatically.

Future data refreshes = rerun Step 4 → commit → push. Nothing else changes:
the app logic, styling and pipeline stay identical — only the input JSON is newer
(this is exactly what the Methodology dialog in the app promises).

## Troubleshooting — exact causes

| Symptom | Exact cause & fix |
|---|---|
| `pip install rasterio` fails | You are on a very old Python → install Python 3.11+, retry |
| Converter: `CHYBA: žádná platná data v bbox` | The tile does not cover the region (check `N49E013`-style name) or band 1 is not the value (open in QGIS) |
| App legend still says `demo vzorek` | `public/data/lst-grid.json` not committed/deployed — the legend tooltip shows the exact reason (HTTP status / parse error) |
| GitHub rejects a push | You committed a file > 100 MB → raw data must NOT be committed; check `git status` |
| rclone upload stalls | Just rerun the same `rclone copy` — it resumes where it stopped |
