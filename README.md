# Chladnější kraj

**Kudy projít v horku? Co a kam vysázet?** — vysvětlitelná AI aplikace proti přehřívání měst pro Plzeňský kraj.

Prototyp pro **Hackathon otevřených dat Plzeňského kraje za využití AI** (Gymnázium Sušice, 13.–14. 11. 2026).

## Co aplikace umí

### Režim Občan — „Kudy projít"
- vybere start a cíl (parky, rybníky, fontány, lesy…)
- nastaví **volby** (maximum stínu, trasa u vody, lavičky, pitná voda, klidné ulice, zeleň, MHD)
  a **záporné volby** (rušné komunikace, stoupání, nestíněné úseky, stavby, davy)
- posuvník **chlad vs. rychlost**
- engine najde **3 varianty** (Nejchladnější / Vyvážená / Nejrychlejší) se skóre chladu,
  odhadem pocitové teploty na úsecích a volitelným „Proč tahle trasa?" vysvětlením

### Režim Samospráva — „Co vysázet" + opatření
- žebříček **hotspotů** s transparentním skóre rizika
  (`0,45·LST + 0,20·absence zeleně + 0,20·zranitelné skupiny + 0,15·hustota`)
- **generátor výsadeb**: rozpočet, typ prostoru, priority (chlazení, cena, biodiverzita, rychlý efekt…),
  omezení (památková zóna, sítě, úzké chodníky, suchá půda) → mix druhů, počty stromů,
  očekávaný pokles LST (ΔLST = min(4 °C, 6,5·√(podíl koruny))) a navržené body na mapě
- **opatření** řizená živou předpovědí (zálivka, chladicí místa, misting, kontroly seniorů)
  s viditelnými spouštěči pravidel
- pro každý výsledek **stopa výpočtu (reasoning trace)**: kroky, váhy, data, předpoklady,
  jistota + „Kopírovat stopu (JSON)" pro audit. **Žádný black box.**

## Zásada transparentnosti

Rozhodovací jádro je **deterministické a auditovatelné**. Generativní AI
(z-ai SDK, volitelná) pouze popisuje již spočítaný výsledek — nikdy nepřepočítává skóre.
Pokud LLM není dostupné, UI spadne na deterministickou šablonu.

## Data (otevřená data)

| Zdroj | Vrstva | Status |
|---|---|---|
| [Copernicus Data Space Ecosystem](https://dataspace.copernicus.eu/) | Sentinel-3 SLSTR LST, Sentinel-2 L2A NDVI | metodika v prototypu (demo grid), pipeline popsána v UI |
| [Copernicus Browser](https://browser.dataspace.copernicus.eu/) | ověření rasterů | — |
| [Open-Meteo](https://open-meteo.com/) | živé počasí + předpověď (teplota, ET₀, srážky) | **živé** |
| [OpenStreetMap](https://www.openstreetmap.org/) | graf chodníků, zeleň, voda | živé souřadnice, atributy úseků demo |
| [ČSÚ](https://www.czso.cz/csu/czso/home) | obyvatelstvo, senioři 65+ | reprezentativní demo hodnoty |
| [data.gov.cz](https://data.gov.cz/) | NKOD registry | — |

Model card, vzorečky a produkční pipeline Copernicusu (GeoTIFF → zonální statistiky → nahrazení demo gridu) jsou přímo v aplikaci v dialogu **„Metodika a zdroje dat"**.

## Architektura

- **Next.js 16 (App Router) + TypeScript + Tailwind 4 + shadcn/ui**
- Leaflet (OSM dlaždice) — LST heatmap, trasy, místa, body výsadeb, hotspoty
- `src/lib/engine/` — deterministické, testovatelné enginy s plnými metadaty stopy:
  - `heat.ts` — agregace LST per území + kompozitní riziko
  - `routing.ts` — Dijkstra s preferenčními vahami, 3 profily tras
  - `planting.ts` — filtry druhů, priority, rozdělení rozpočtu, model ΔLST
- `src/lib/data/plzen.ts` — kurátorovaná open-data vrstva Plzně (nody, hrany, druhy stromů, LST grid)
- API routes: `/api/weather`, `/api/hotspots`, `/api/routes`, `/api/planting`, `/api/ai-summary`
- žádná databaze — vše deterministické + cache v paměti (Vercel-friendly)

## Lokální vývoj

```bash
bun install
bun run dev      # http://localhost:3000
bun run lint
```

## Google Drive ↔ repozitář ↔ Vercel (workflow syrových dat)

**Ano — všechna stažená data (Copernicus GeoTIFF/.NC, ZIPy z portálů) patří na Google Drive, ne do repozitáře.**
Repozitář a Vercel vidí pouze malá zpracovaná JSON/GeoJSON. Nikdo nemusí ručně proklikávat stovky složek — `rclone` zkopíruje celý strom jedním příkazem.

```
Google Drive (raw: rastery, ZIPy — GIGABYTES, gitignored)
   │  rclone copy (rekurzivně, jedním příkazem)
   ▼
data/raw/  (lokálně u každého člena týmu)
   │  zpracování (skripty: mosaic, cloud mask, °C, NDVI, zonal stats)
   ▼
src/lib/data/*.ts  nebo  public/data/*.json  (KILOBYTES — commit → push)
   │  git push (GitHub)
   ▼
Vercel deploy (bere výhradně data z repozitáře)
```

**1) Drive → lokální počítač** (jednorázová konfigurace, pak už jen jeden příkaz):

```bash
rclone config          # remote pojmenujte "gdrive" (typ: drive, scope: 1, zbytek Enter, auto config)
./scripts/pull-from-drive.sh                  # synchronizuje gdrive:Hackathon-Data/raw → data/raw
./scripts/pull-from-drive.sh gdrive PodSlozka/jiná  # vlastní cesta
```

**2) Lokální data → git:** zpracujte raw soubory skriptem tak, aby výsledkem byl malý JSON/GeoJSON
(kilobajty, ne megabajty) a commitněte. Syrová data nikdy necommitujte — GitHub odmítá soubory >100 MB.

**Filtr „co z 281 složek se týká Plzeňského kraje“:** skript projde stažený strom a podle názvů
tile (N49E013…) nebo CZ/Urban-Atlas balíčků vypíše, které soubory region pokrývají:

```bash
python scripts/find_kraj_files.py "C:\Users\jmeno\Downloads\copernicus"   # Windows
python3 scripts/find_kraj_files.py data/raw                               # Linux/macOS
```

**Korunní pokryv stromů (reálná data, už zapojené):** raw GeoTIFF (10 m, EPSG:3035, mozaika ČR)
z `data/raw/` → dvě malé JSON mřížky + průhledný PNG overlay v oficiální CLMS TCD barevné škále:

```bash
python3 scripts/canopy_to_json.py data/raw/user_upload.tif   # nebo vlastní cesta k .tif
```

Výstupy (commitovat): `src/lib/data/canopy-plzen.json`, `src/lib/data/canopy-kraj.json`,
`public/data/canopy-plzen.png`. Vyžaduje GDAL nástroje (`apt install gdal-bin` / `brew install gdal`).
Tyto soubory pohání: korunní pokryv na mapě (Samospráva), podíl zeleně v riziku přehřívání,
konkrétní body „Co vysázet“ i zeleň na občanských trasách.

**3) Drive → Vercel:** *přímé připojení neexistuje.* Vercel čte výhradně z repozitáře.
Proto platí: **co má appka číst, to musí být commitnuté** (malé zpracované JSONy).
Velké raw soubory zůstávají jen na Drive pro zpracování.

**Chybové hlášky:** aplikace nikdy nesype obecné „něco se pokazilo" — každé selhání vrací
přesný důvod (scope endpointu, HTTP status, upstream reason, příčinu chyby, návrh známých hodnot id).
Viz `src/lib/errors.ts` a `error.tsx`.

## Deploy na Vercel

1. Push to repo (already done) → [vercel.com/new](https://vercel.com/new)
2. Import `SimonCurda/Susice26`
3. Framework Preset: **Next.js** (auto-detected), žádné env proměnné nejsou potřeba
4. Deploy.

## Licence a data

Open data dle licencí zdrojů (ODbL / CC-BY). Prototyp nenahrazuje oficiální výstrahy ČHMÚ ani projektovou dokumentaci.
