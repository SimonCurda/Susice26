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
  { name: 'Copernicus HRL Tree Cover Density (CLMS, 10 m)', url: 'https://land.copernicus.eu/', use: 'REÁLNÁ data v prototypu — LESY A KORUNNÍ POKRYV: výskyt korunního pokryvu stromů nad celou ČR (mozaika 10 m, EPSG:3035, letošní vydání). Pohání podíl zeleně v riziku přehřívání, konkrétní body výsadby i zeleň na trasách. Posun vůči skutečnosti ověřen FFT-korelací s OSM lesy (< 10 m).' },
  { name: 'Copernicus Data Space Ecosystem (CDSE) — Sentinel-3 SLSTR, Process API', url: 'https://dataspace.copernicus.eu/', use: 'REÁLNÁ data v prototypu — TEPLOTY: satelitní raster termálního kanálu S7 (10,85 µm) nad Plzní, stažený živě přes Process API (OAuth klient). Jasová teplota v kelvinech → °C; sleduje teplotu povrchu typicky na 1–2 K. Poslední přlet do 72 h; když je plná oblačnost, vrátí se přesný důvod a mapa použije ukotvený model. Plus opt-in vrstva „Vegetace teď“ (NDVI z 10 m Sentinel-2 L2A, posledních 30 dní).' },
  { name: 'Copernicus Data Space Ecosystem — Statistical API (historie léta 2016→ + vegetace 2018→)', url: 'https://documentation.dataspace.copernicus.eu/APIs/SentinelHub/Statistical.html', use: 'REÁLNÁ data: (1) historie teploty povrchu Plzně (červen–srpen od 2016) přímo z Copernicusu bez stahování rasterů — denní agregáty SLSTR S7, denní přlety ~10:30 LT; dny s oblaky se filtrují proti ERA5 (pravidlo: sat ≥ ERA5 tMax − 8 °C a ≤ tMax + 18 °C, mediana jasných dnů). (2) historie vegetace (červen–srpen od 2018) — letní NDVI (B08/B04, listová biomasa) a NDMI (B8A/B11, vlhkost vegetace) z měsíčních mozaik nejméně oblačných scén Sentinel-2 L2A; měsíc se počítá od 40 % validních land pixelů (SCL filtr oblaků, stínu, vody), trend biomasy a vlhkosti = OLS za dekádu.' },
  { name: 'ERA5 reanalýza (Copernicus C3S, ECMWF) — historie teplot 1970→', url: 'https://cds.climate.copernicus.eu/datasets/reanalysis-era5-land', use: 'REÁLNÁ data: roční průměry, tropické dny (≥ 30 °C), tropické noci (≥ 20 °C), rekordy a lineární trend oteplení pro Plzeň + 7 měst kraje. V prototypu doručeno přes otevřený broker Open-Meteo archive (CC-BY 4.0) — stejný dataset ERA5.' },
  { name: 'Open-Meteo — vlhkost, rosný bod, ET₀ (ECMWF IFS / ERA5)', url: 'https://open-meteo.com/en/docs', use: 'REÁLNÁ data v prototypu — VLHKOST: relativní vlhkost 2 m a rosný bod (Magnusova formule). Reanalýza ERA5 je data služby Copernicus Climate Change Service (C3S); Sentinel-3 sám povrchovou vlhkost neměří (SLSTR nemá takový produkt), proto je ERA5 správný zdroj. Vlhkost pohání interpretaci tepelného stresu, tropických nocí i zálivkových rad.' },
  { name: 'Copernicus Browser', url: 'https://browser.dataspace.copernicus.eu/', use: 'Interaktivní ověření a export rasterských vrstev — vizuální srovnání naší LST vrstvy se satelitem.' },
  { name: 'CLMS Colourmaps & Legends (GitHub)', url: 'https://github.com/copernicus-land/colourmaps-legends', use: 'Oficiální barevné škály Copernicus Land Monitoring Service — naše LST vrstva používá škálu „Temperature Color Index“, takže vypadá stejně jako Copernicus Browser. Licence GPL-3.0, použité hodnoty barev jsou atribuovány v kódu.' },
  { name: 'Open-Meteo — počasí a předpověď', url: 'https://open-meteo.com/', use: 'Živé počasí a předpověď (aktuální teplota, pocitová teplota, ET₀, srážky, oblačnost) + broker historické ERA5 řady. Plně funkční i v této demonstraci; 10minutová cache.' },
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
              <h3 className="font-semibold">2. Co je živé vs. demo — a kde se bere co</h3>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-xs leading-relaxed">
                <li><b>TEPLOTY (Copernicus / Sentinel-3, REÁLNÉ):</b> mapa Plzně = skutečný satelitní raster Sentinel-3 SLSTR kanál S7 (10,85 µm, jasová teplota v K → °C), stažený ŽIVĚ přes Copernicus Data Space Process API (OAuth klient — kolekce S3SLSTR, poslední přlet do 72 h). L2 LST produkt Process API nevystavuje, ale S7 sleduje teplotu povrchu typicky na 1–2 K; proto layer označujeme „SLSTR termální data“. Mimo raster (zbytek kraje) = anomálie VRC ukotvená na živé měření Open-Meteo × transparentní škála (sezóna 0,5–1,0 · den/noc 1,0/0,45 · oblaka 0,55–1,0). Mapa proto nikdy neukazuje letní 33 °C při listopadových 1,3 °C — zdroj vrstvy je vždy vidět v legendě („reálná data Sentinel-3“ vs. „ukotvený model“).</li>
                <li><b>LESY A KORUNNÍ POKRYV (Copernicus CLMS, REÁLNÉ):</b> HRL Tree Cover Density 10 m — vrstva na mapě v režimu Samospráva, podíl zeleně v riziku přehřívání, navrhované body výsadby i zeleň na trasách. Zachycuje hlavně lesní porosty, drobnou městskou listnatou zeleň může podhodnocovat; u tras se proto kombinuje s kurátorskými hodnotami tam, kde detekuje méně než 10 %.</li>
                <li><b>VLHKOST (ERA5/ECMWF = data Copernicus C3S, REÁLNÉ):</b> relativní vlhkost 2 m + rosný bod (Magnusova formule) v liště počasí, srovnání regionů i v AI kontextu. Pomáhá ve třech věcech: 1) rosný bod nad 15 °C = parno — pot se špatně odpařuje a pocitová teplota stoupá nad „suchý“ ekvivalent; 2) vlhké noci se hůř ochlazují vyzařováním — to je fyzika za tropickými nocemi (tMin ≥ 20 °C), hlavní zabiják seniorů ve vlnách vedra; 3) nízká vlhkost + vysoká ET₀ = stres zálivky mladých výsadeb. Sentinel-3 sám povrchovou vlhkost neměří (jen vlhkost celého atmosférického sloupce, pro tepelný stres nepoužitelnou) — proto ERA5, což je reanalýza Copernicus Climate Change Service.</li>
                <li><b>Historie teplot a vegetace (REÁLNÁ, tři řady):</b> záložka „Historie“ v režimu Samospráva: (1) ERA5 reanalýza (Copernicus C3S) od 1970 — roční průměry, tropické dny/noci, rekordy, trend oteplení, srovnání 7 měst kraje; (2) satelitní léta 2016→ z CDSE Statistical API (Sentinel-3 SLSTR S7, denní přlety, červen–srpen, mediana jasných dnů filtrovaných proti ERA5); (3) vegetační vývoj 2018→ — letní NDVI (biomasa) a NDMI (vlhkost vegetace) z Sentinel-2 L2A, měsíční mozaiky nejméně oblačných scén, OLS trend za dekádu. Sentinel/VRC = teploty historicky z Copernicusu, živé teploty z meteorologického API (Open-Meteo) — dvě role, žádné míchání. Endpoint <code className="rounded bg-muted px-1">/api/copernicus/history</code> vrací všechny řady + přesné důvody případného výpadku.</li>
                <li><b>Vegetace teď (REÁLNÁ, opt-in):</b> na mapě v režimu Samospráva lze přepnout živý NDVI overlay ze Sentinel-2 L2A (10 m, posledních 30 dní, oblaky průhledné) přes <code className="rounded bg-muted px-1">/api/copernicus/ndvi</code> — zelená škála ukazuje aktuální stav vegetace; voda se maluje tyrkysově.</li>
                <li><b>Živé:</b> počasí, vlhkost a předpověď (Open-Meteo), graf tras a místa (OSM anchor souřadnice), všechen interaktivní výpočet (routing, výsadba, riziko), stažení satelitního rasteru i NDVI (CDSE).</li>
                <li><b>Ceny výsadeb:</b> orientační tržní ceny (sadba + 3 roky péče) 26–42 tis. Kč/strom.</li>
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
                <li>Výsadba — JAKÝ STROM (deterministický algoritmus, žádné hádání): 1) filtr druhů podle typu prostoru a omezení (památková zóna, podzemní sítě, úzké chodníky, suchá půda); 2) skóre = vážený průměr 6 normalizovaných vlastností (chlazení, cenová účinnost, biodiverzita, rychlost růstu, nízká údržba, nízká alergenicita) — váhy se řídí vašimi zvolenými prioritami a jsou vystaveny ve stopě výpočtu; 3) rozdělení rozpočtu 50/30/20 pro top 3 druhy (ochrana proti monokultuře).</li>
                <li>Výsadba — KDE (reálná data, ne syntetické body): engine scanuje mřížku korunního pokryvu Copernicus v okruhu 1,8 km od centra hotspotu a vybírá buňky, které jsou zároveň NEJTEPLEJŠÍ (LST vrstva) a mají NEJMÉNĚ detekovaných stromů (skóre = LST − korunní pokryv/25); body minimálně ~120 m od sebe. Hodnoty LST i korunního pokryvu vidíte v tooltipu každého bodu.</li>
                <li>Výsadba — JAKÝ DOPAD NA TEPLOTU: ΔLST = min(4 °C, 6,5·√(podíl nové korunní plochy na území)) — konzervativní strop dle literatury (1–4 °C pro městskou vegetaci). Fyzika za tím: koruna blokuje sluneční zahřívání povrchu (pod korunou je asfalt o 25–35 °C chladnější) a evapotranspirace odpařuje vodu do vzduchu (výpar spotřebuje energii); při nízké vlhkosti vzduchu je efekt výparného chlazení silnější — proto vnášíme vlhkost do zálivkových rad a interpretace.</li>
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
