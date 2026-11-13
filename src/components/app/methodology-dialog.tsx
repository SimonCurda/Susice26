'use client';

/**
 * Methodology / model-card dialog — data provenance, what is live vs demo,
 * Copernicus production pipeline and the used formulas. Full transparency.
 */

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ExternalLink } from 'lucide-react';

const SOURCES = [
  { name: 'Copernicus HRL Tree Cover Density (CLMS, 10 m)', url: 'https://land.copernicus.eu/', use: 'REÁLNÁ data v prototypu: výskyt korunního pokryvu stromů nad celou ČR (mozaika 10 m, EPSG:3035). Pohání podíl zeleně v riziku, konkrétní body výsadby i zeleň na trasách. Posun vůči skutečnosti ověřen FFT-korelací s OSM lesy (< 10 m).' },
  { name: 'Copernicus HRL Tree Cover Density (CLMS, 10 m)', url: 'https://land.copernicus.eu/', use: 'REÁLNÁ data v prototypu: výskyt korunního pokryvu stromů nad celou ČR (mozaika 10 m, EPSG:3035). Pohání podíl zeleně v riziku, konkrétní body výsadby i zeleň na trasách. Posun vůči skutečnosti ověřen FFT-korelací s OSM lesy (< 10 m).' },
  { name: 'Copernicus Data Space Ecosystem', url: 'https://dataspace.copernicus.eu/', use: 'Zdroj satelitních dat (Sentinel-3 SLSTR LST, Sentinel-2 L2A NDVI) — teplota povrchu a vegetace.' },
  { name: 'Copernicus Browser', url: 'https://browser.dataspace.copernicus.eu/', use: 'Interaktivní ověření a export rasterských vrstev.' },
  { name: 'CLMS Colourmaps & Legends (GitHub)', url: 'https://github.com/copernicus-land/colourmaps-legends', use: 'Oficiální barevné škály Copernicus Land Monitoring Service — naše LST vrstva používá škálu „Temperature Color Index“, takže vypadá stejně jako Copernicus Browser. Licence GPL-3.0, použité hodnoty barev jsou atribuovány v kódu.' },
  { name: 'Open-Meteo', url: 'https://open-meteo.com/', use: 'Živé počasí a předpověď (aktuální teplota, ET₀, srážky). Plně funkční i v této demonstraci.' },
  { name: 'OpenStreetMap', url: 'https://www.openstreetmap.org/', use: 'Síť chodníků, zeleň, vodní prvky — základ grafu tras a mapových bodů.' },
  { name: 'ČSÚ (sčítání 2021)', url: 'https://www.czso.cz/csu/czso/home', use: 'Obyvatelstvo a demografický profil území (v prototypu reprezentativní hodnoty).' },
  { name: 'Národní katalog otevřených dat', url: 'https://data.gov.cz/', use: 'Registralizace dalších datasetů kraje (transport, zdravotnictví…).' },
];

export function MethodologyDialog() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="text-xs underline-offset-2 hover:underline">
          Metodika a zdroje dat
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Metodika, zdroje dat a karta modelu</DialogTitle>
          <DialogDescription>
            Transparentnost je náš princip: aplikace není black box. Zde je přesně popsáno, co je živé, co je demo a jak se připojí reálná data.
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-[60vh] pr-3">
          <div className="space-y-4 text-sm">
            <section>
              <h3 className="font-semibold">1. Zdroje dat (otevřená data)</h3>
              <ul className="mt-2 space-y-2">
                {SOURCES.map((s) => (
                  <li key={s.url} className="rounded-md border p-2 text-xs">
                    <a href={s.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-semibold text-emerald-800 hover:underline">
                      {s.name} <ExternalLink className="h-3 w-3" />
                    </a>
                    <p className="mt-0.5 text-muted-foreground">{s.use}</p>
                  </li>
                ))}
              </ul>
            </section>
            <section>
              <h3 className="font-semibold">2. Co je živé vs. demo</h3>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-xs leading-relaxed">
                <li><b>REÁLNÁ data:</b> korunní pokryv stromů (Copernicus HRL Tree Cover Density, 10 m, mozaika ČR) — vrstva na mapě v režimu Samospráva, podíl zeleně v riziku přehřívání, navrhované body výsadby i zeleň na trasách. Vrstva zachycuje hlavně lesní porosty, drobnou městskou listnatou zeleň může podhodnocovat; proto se u tras kombinuje s kurátorskými hodnotami tam, kde detekuje méně než 10 %.</li>
                <li><b>Živé:</b> počasí a předpověď (Open-Meteo), graf tras a místa (OSM anchor souřadnice), všechen interaktivní výpočet (routing, výsadba, riziko).</li>
                <li><b>LST vrstva (ukotvený model):</b> rastr je anomálie městského ostrova tepla věrná metodice Sentinel-3 SLSTR (VRC jádro +6,4 °C, průmysl +2,8–5 °C, parky −2,2–3,4 °C, voda −2,2 °C), ALE absolutní hodnoty se počítají jako REÁLNÁ aktuální teplota vzduchu (Open-Meteo) × transparentní škála (sezóna 0,5–1,0 · den/noc 1,0/0,45 · oblaka 0,55–1,0). Mapa proto nikdy neukazuje letní 33 °C, když je venku listopadové 1,3 °C — a v letní parnu poledne ukáže reálných ~35 °C na asfaltu. Relativní vzorce (VRC struktura, chladnější trasy) zůstávají stejné jako u satelitních dat.</li>
                <li><b>Reálná Sentinel-3 termální data (AKTIVNÍ):</b> endpoint <code className="rounded bg-muted px-1">/api/lst-grid</code> stahuje skutečný satelitní raster přes Copernicus Data Space Process API (OAuth klient): kolekce S3SLSTR (L1B), termální kanál S7 (10,85 µm), jasová teplota v kelvinech → °C, poslední přlet za 72 h. (Samotný produkt L2 LST Process API nevystavuje; S7 sleduje teplotu povrchu typicky na 1–2 K.) Plzeň = reálná data, zbytek kraje = ukotvený model; legenda i zdroj se přepnou na „reálná data Sentinel-3“. Když raster nenastane (oblačnost), endpoint vrátí PŘESNÝ důvod a mapa zůstane na ukotveném modelu.</li>
                <li><b>Ceny výsadeb:</b> orientační tržní ceny (sadbа + 3 roky péče) 26–42 tis. Kč/strom.</li>
              </ul>
            </section>
            <section>
              <h3 className="font-semibold">3. Produkční pipeline Copernicus (po hackathonu)</h3>
              <ol className="mt-1 list-decimal space-y-1 pl-5 text-xs leading-relaxed">
                <li>Stáhnout Sentinel-3 SLSTR LST a Sentinel-2 L2A (BOA) přes Copernicus Data Space (API odata/catalog).</li>
                <li>Zpracovat v open-source stacku (Python/rasterio): mosaic, cloud mask, přepočet na °C, NDVI vrstva.</li>
                <li>Zonální statistiky per území (městské části/obce) → nahradí demo grid v <code className="rounded bg-muted px-1">src/lib/data/plzen.ts</code>. Kanál pro korunní pokryv už běží: <code className="rounded bg-muted px-1">scripts/canopy_to_json.py</code> (data/raw/*.tif → JSON gridy + PNG overlay).</li>
                <li>Weekly refresh (nebo dle teplé vlny) — vrstvy se ukládají do cache; UI i logika zůstávají beze změny.</li>
              </ol>
            </section>
            <section>
              <h3 className="font-semibold">4. Použité modely (vše explicitní)</h3>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-xs leading-relaxed">
                <li>Riziko přehřívání: <code className="rounded bg-muted px-1">0,45·norm(LST) + 0,20·(1−zeleň) + 0,20·zranitelné + 0,15·hustota</code></li>
                <li>Trasa: Dijkstra, cena úseku = čas × (1 + postihy − úlevy); postihy/úlevy čteny z vašich voleb (stín, voda, zeleň, provoz, stoupání, stavby…).</li>
                <li>Pocit na úseku: teplota + korekce stín (−3,5 °C max), voda (−2,5 °C), zeleň (−1,8 °C max), provoz (+0,5 °C/úroveň).</li>
                <li>Výsadba: ΔLST = min(4 °C, 6,5·√(podíl korunní plochy na území)); rozdělení rozpočtu 50/30/20 pro top 3 druhy.</li>
                <li>AI vrstva: generativní shrnutí POUZE popisuje spočítaný výsledek; nic nepřepočítává. Jadro je deterministické a auditovatelné (kopie JSON stopy).</li>
              </ul>
            </section>
            <section>
              <h3 className="font-semibold">5. Generativní AI (OpenRouter)</h3>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-xs leading-relaxed">
                <li><b>Co AI dělá:</b> „AI poradce“ — konverzační analytik dostupný v obou režimech, který nad ŽIVÝM přehledem faktů (počasí Open-Meteo, stav rasteru Sentinel-3, hotspot ranking, místa ke schlazení + aktuální stav rozhraní) uvažuje, vysvětluje souvislosti a doporučuje. Dále generativní shrnutí návrhu výsadby.</li>
                <li><b>Co AI NEdělá:</b> nepřepočítává skóre, nemění trasy ani návrhy výsadby, není zdrojem čísel — všechna čísla pocházejí z přehledu živých dat; hodnotu, která není k dispozici, explicitně označí. Rozhodnutí zůstávají na deterministických motorech.</li>
                <li><b>Modely:</b> OpenRouter (klíč v proměnné OPENROUTER_API_KEY, server-side only), výchozí reasoning model <code className="rounded bg-muted px-1">deepseek/deepseek-v4.1-flash-1017</code>, automatické fallbacky <code className="rounded bg-muted px-1">deepseek/deepseek-chat</code> → <code className="rounded bg-muted px-1">meta-llama/llama-3.3-70b-instruct</code> (dostupnost modelů se liší dle regionu). Poslední záloha: z-ai SDK, poté deterministická šablona — důvod každého pádu se zobrazí přesně.</li>
                <li><b>Protifabricační pravidla:</b> systémový prompt zakazuje vnášet čísla mimo přehled, vyžaduje rozlišovat reálná vs. modelovaná data, češtinu, stručnost a žádné emodži. Fakt sheet je sestavován serverem z těch samých endpointů, které pohání UI (žádná cesta k „vynechanému“ kontextu).</li>
              </ul>
            </section>
            <section>
              <h3 className="font-semibold">6. Prohlášení</h3>
              <p className="text-xs text-muted-foreground">
                Prototyp pro Hackathon otevřených dat Plzeňského kraje. Nenahrazuje oficiální výstrahy ČHMÚ ani projektovou dokumentaci.
                Zdrojová data mají licence ODbL/CC-BY dle uvedených portálů.
              </p>
            </section>
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
