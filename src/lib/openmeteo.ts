/**
 * Open-Meteo open-data client (server-side) with in-memory cache.
 * Docs: https://open-meteo.com/en/docs — free, no API key, CC-BY 4.0 attribution required.
 */

import { WEATHER_POINTS } from '@/lib/data/plzen';
import type { HeatAlert, WeatherData } from '@/lib/engine/types';

const CACHE_TTL_MS = 10 * 60 * 1000;
let cache: { at: number; data: WeatherData } | null = null;

interface OpenMeteoMulti {
  latitude: number;
  longitude: number;
  current?: {
    time: string;
    temperature_2m: number;
    relative_humidity_2m: number;
    apparent_temperature: number;
    is_day: number;
    precipitation: number;
    weather_code: number;
    cloud_cover: number;
    wind_speed_10m: number;
  };
  daily?: {
    time: string[];
    temperature_2m_max: number[];
    temperature_2m_min: number[];
    precipitation_sum: number[];
    et0_fao_evapotranspiration: number[];
    shortwave_radiation_sum: number[];
  };
}

export async function getWeather(): Promise<WeatherData> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.data;

  const lats = WEATHER_POINTS.map((p) => p.lat).join(',');
  const lngs = WEATHER_POINTS.map((p) => p.lng).join(',');
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lngs}` +
    '&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,et0_fao_evapotranspiration,shortwave_radiation_sum' +
    '&current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,cloud_cover,wind_speed_10m' +
    '&forecast_days=5&timezone=Europe%2FPrague';

  const res = await fetch(url, { next: { revalidate: 600 } });
  if (!res.ok) throw new Error(`Open-Meteo failed: ${res.status}`);
  const json = (await res.json()) as OpenMeteoMulti[];
  const arr = Array.isArray(json) ? json : [json];

  const plzenIdx = WEATHER_POINTS.findIndex((p) => p.name === 'Plzeň');
  const pl = arr[plzenIdx];

  const daily = (pl.daily?.time ?? []).map((t, i) => ({
    date: t,
    tMax: Math.round((pl.daily!.temperature_2m_max[i] ?? 0) * 10) / 10,
    tMin: Math.round((pl.daily!.temperature_2m_min[i] ?? 0) * 10) / 10,
    precipitation: Math.round((pl.daily!.precipitation_sum[i] ?? 0) * 10) / 10,
    et0: Math.round((pl.daily!.et0_fao_evapotranspiration[i] ?? 0) * 10) / 10,
    radiation: Math.round(pl.daily!.shortwave_radiation_sum[i] ?? 0),
  }));

  const today = daily[0];
  const next3 = daily.slice(0, 3);
  const alert = buildAlert(today, next3);
  const tropicalNights = next3.filter((d) => d.tMin >= 20).length;

  const wateringAdvice = buildWateringAdvice(today, daily[1], daily[2]);

  const data: WeatherData = {
    fetchedAt: new Date().toISOString(),
    plzen: {
      current: {
        temperature: Math.round((pl.current?.temperature_2m ?? 0) * 10) / 10,
        apparentTemperature: Math.round((pl.current?.apparent_temperature ?? 0) * 10) / 10,
        humidity: Math.round(pl.current?.relative_humidity_2m ?? 0),
        windSpeed: Math.round((pl.current?.wind_speed_10m ?? 0) * 10) / 10,
        weatherCode: pl.current?.weather_code ?? 0,
        isDay: (pl.current?.is_day ?? 1) === 1,
        precipitation: Math.round((pl.current?.precipitation ?? 0) * 10) / 10,
      },
      daily,
    },
    region: WEATHER_POINTS.map((p, i) => ({
      name: p.name,
      temperature: Math.round((arr[i].current?.temperature_2m ?? 0) * 10) / 10,
      apparentTemperature: Math.round((arr[i].current?.apparent_temperature ?? 0) * 10) / 10,
      altitudeNote: p.altitudeNote,
    })),
    alert,
    wateringAdvice,
    tropicalNightsNext3: tropicalNights,
  };

  cache = { at: Date.now(), data };
  return data;
}

function buildAlert(today: WeatherData['plzen']['daily'][number], next3: WeatherData['plzen']['daily']): HeatAlert {
  const triggeredBy: string[] = [];
  const tMax = today?.tMax ?? 20;
  const tMin = today?.tMin ?? 12;
  const maxNext3 = Math.max(...next3.map((d) => d.tMax));

  if (tMax >= 32 || maxNext3 >= 35) {
    triggeredBy.push(` denní max ${tMax} °C`, maxNext3 >= 35 ? `, výhled max ${maxNext3} °C` : '');
    if (tMax >= 34 || maxNext3 >= 37)
      return { level: 'extreme', title: 'Extrémní vedro', message: 'Doporučeno omezit venkovní aktivity 11–17 h, aktivovat chladicí místa a zavlažování.', triggeredBy };
    return { level: 'warning', title: 'Výstraha před vysokými teplotami', message: 'Vedro — senioři a děti by měli být 11–17 h v prostorách, dostatek pitného režimu.', triggeredBy };
  }
  if (tMax >= 28) {
    triggeredBy.push(` denní max ${tMax} °C`);
    return { level: 'watch', title: 'Pozor na teplo', message: 'Teploty nad 28 °C — doporučen stín a pitný režim, náročné aktivity raději dopoledne.', triggeredBy };
  }
  return { level: 'ok', title: 'Žádná horkostní výstraha', message: 'Teploty jsou pro venkovní aktivity bezpečné.', triggeredBy: [`denní max ${tMax} °C`] };
}

function buildWateringAdvice(
  today: WeatherData['plzen']['daily'][number],
  d1?: WeatherData['plzen']['daily'][number],
  d2?: WeatherData['plzen']['daily'][number]
): string {
  const et0 = today?.et0 ?? 2;
  const rain = (today?.precipitation ?? 0) + (d1?.precipitation ?? 0) + (d2?.precipitation ?? 0);
  if (et0 >= 4 && rain < 5)
    return `Vysoká evapotranspirace (${et0} mm/den) bez výraznějšího deště — doporučena zálivka mladých výsadeb ráno (do 8 h) 50 l/strom.`;
  if (rain >= 5) return `Očekává se srážka ${rain} mm — zálivku lze odložit.`;
  return `Evapotranspirace ${et0} mm/den — zálivka dle potřeby, ideálně časně ráno.`;
}
