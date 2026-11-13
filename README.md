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

## Deploy na Vercel

1. Push to repo (already done) → [vercel.com/new](https://vercel.com/new)
2. Import `SimonCurda/Susice26`
3. Framework Preset: **Next.js** (auto-detected), žádné env proměnné nejsou potřeba
4. Deploy.

## Licence a data

Open data dle licencí zdrojů (ODbL / CC-BY). Prototyp nenahrazuje oficiální výstrahy ČHMÚ ani projektovou dokumentaci.
