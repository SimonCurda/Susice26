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

---

## Step 6 — real Sentinel-3 LST over the API (optional, 3 min, browser only)

The app ships with the **anchored UHI model** (live Open-Meteo measurement ×
transparent scale) so the heat map is physically correct at any moment.
To switch the map to **real Sentinel-3 SLSTR LST pixels** (last 72 h, clear-sky
mosaic, rendered live through the Copernicus Data Space Process API):

1. You are already logged into the Copernicus Browser — same account works:
   open <https://id.dataspace.copernicus.eu/> (top-right → My Account).
2. Tab **"Clients"** (OAuth clients) → **"Create client"**:
   - Client name: `chladnejsi-kraj`
   - Root URL: `https://localhost` (anything, unused)
3. In the client configuration that opens after saving:
   - **Capability config → Service Accounts Enabled: ON**
   - Standard Flow / Direct Access Grants: OFF (not needed)
4. Save → tab **"Credentials"** → **Copy the Client secret**.
5. Add the two values as environment variables:

| Variable | Where |
|---|---|
| `CDSE_CLIENT_ID` | UUID shown as the client ID (starts with `sh-`) |
| `CDSE_CLIENT_SECRET` | copied secret |

Locally: put them into `.env` (never commit `.env` — it is gitignored).
On Vercel: Project → Settings → Environment Variables → add both → redeploy.

That's it. `/api/lst-grid` then serves `source: "sentinel-3-real"`, the map
legend switches to **"reálná data Sentinel-3"**, and no code change is needed.
If the render fails (e.g. fully clouded skies for 72 h), the endpoint reports
the EXACT upstream reason in `note` and falls back to the anchored model.

API sanity notes (already implemented in `src/lib/copernicus/*`, verified live
against CDSE on 2026-11-13/14):
- **Process API** (`https://sh.dataspace.copernicus.eu/api/v1/process`):
  collection `S3SLSTR` (L1B), thermal channel `S7` (10.85 µm) — brightness
  temperature in Kelvin → °C via evalscript. The *L2 LST* product is NOT
  exposed through the Sentinel Hub Process API; S7 tracks surface skin
  temperature within ~1–2 K for natural surfaces, which is what the layer
  honestly represents. TOP-LEVEL `input` / `output` / `evalscript` — the older
  `{ "process": { … } }` wrapper is rejected with `COMMON_BAD_PAYLOAD`.
- **Statistical API** (`…/api/v1/statistics`, history of summers since 2016):
  the aggregation object carries `timeRange` + `aggregationInterval`
  (`{"of": "P1D"}`) + `evalscript` + `width`/`height` (resolution via pixel
  size is NOT accepted — send explicit width/height, ~500 m/cell). The
  evalscript MUST define a separate `dataMask` output (`id: "dataMask"`),
  otherwise the engine rejects the script with "Output dataMask requested
  but missing". Per-day intervals + `mosaickingOrder: "leastRecent"` give a
  consistent ~10:30 LT day-pass series (monthly ORBIT mosaics mix day/night
  passes and read ~12 °C colder).
- **NDVI overlay** (`/api/copernicus/ndvi`): collection `S2L2A`, 30-day window,
  `maxCloudCoverage: 30`, most-recent mosaic; SCL class 6 → water, 8/9/10 →
  transparent clouds; 340×260 PNG data URI rendered as Leaflet ImageOverlay.
- in-memory caches: LST raster 3 h (negative 15 min), NDVI 6 h (negative
  30 min), satellite history per year 7 d (running year 2 h), ERA5 12 h

## Step 7 — historical temperatures (ERA5 + satellite, automatic)

With the same two env variables from Step 6 the app serves THREE new things,
all cached server-side — nothing else to configure:

1. **Historie tab** (Samospráva mode → "Historie"):
   - ERA5 (Copernicus C3S) yearly stats since 1970: mean, tropical days
     (≥ 30 °C), tropical nights (≥ 20 °C), record day, linear warming trend
     (OLS, °C/decade) + KPI comparison for 7 towns of the region.
     Delivered through the free open broker Open-Meteo archive (same ERA5
     dataset, no API key). Later upgrade to the native CDS API = edit
     `src/lib/data/era5.ts` only (needs a free CDS API key).
   - Satellite summer history since 2016: Sentinel-3 SLSTR S7 via CDSE
     Statistical API (one request per year, ~6 s each, parallel). Days hit
     by clouds are filtered against the ERA5 daily tMax (surface reading
     must be within [tMax − 8, tMax + 18] °C) → median of clear days per
     month → summer index. Chunks warm up in the background; the UI polls
     until done (typically < 1 min).
2. **"Vegetace teď (NDVI)"** map toggle (Samospráva): live Sentinel-2 NDVI.
3. **Live LST raster** on the map (Step 6 behaviour, now active by default).

All endpoints keep the exact-error policy: every failure names its upstream
reason (HTTP status, CDSE error message, rate-limit cause) and the app falls
back gracefully (anchored model / ERA5-only history).

---

## Step 8 — generative AI brain via OpenRouter (optional, 2 min)

The deterministic engines always decide; the AI layer ("AI poradce" chat +
planting summary) reasons and narrates on top of a live fact sheet built from
the same endpoints that power the UI.

1. Create a key at <https://openrouter.ai/settings/keys> (sk-or-v1-…).
2. Add environment variables:

| Variable | Meaning |
|---|---|
| `OPENROUTER_API_KEY` | your secret key (never commit, never expose client-side) |
| `OPENROUTER_MODEL` | optional override of the primary model |

Locally: `.env`. On Vercel: Project → Settings → Environment Variables → add →
redeploy.

Model availability is REGION-DEPENDENT (EU blocks some US-hosted models —
OpenAI/Anthropic/Google routing may return 403 "not available in your region").
Verified live from Czechia on 2026-11-14:

- `deepseek/deepseek-v4.1-flash-1017` — default; reasoning-capable, ~$0.04/$0.5 per 1M tokens
- `deepseek/deepseek-chat` — fallback 1
- `meta-llama/llama-3.3-70b-instruct` — fallback 2

If every OpenRouter model fails, the chat endpoint reports the EXACT reason of
each attempt and the planting summary falls back to the deterministic template
(`source: "template"`, `aiError` carries the reason). The reasoning models spend
part of the token budget on hidden reasoning, so responses can take up to ~30 s
— the UI shows an "Analyzuji živá data…" state.
