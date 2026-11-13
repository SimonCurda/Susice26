/* Credential smoke-test: CDSE OAuth token + Process API, OpenRouter chat.
 * Reads credentials from environment (.env.local — never hardcode, never commit). */
import { PNG } from 'pngjs';

const CDSE_CLIENT_ID = process.env.CDSE_CLIENT_ID;
const CDSE_CLIENT_SECRET = process.env.CDSE_CLIENT_SECRET;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

if (!CDSE_CLIENT_ID || !CDSE_CLIENT_SECRET) console.log('CDSE: přihlašovací údaje nejsou v env — test přeskočen');
if (!OPENROUTER_API_KEY) console.log('OpenRouter: klíč není v env — test přeskočen');


async function cdseTest(): Promise<void> {
  const tokenRes = await fetch('https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: CDSE_CLIENT_ID,
      client_secret: CDSE_CLIENT_SECRET,
    }),
    signal: AbortSignal.timeout(20000),
  });
  if (!tokenRes.ok) {
    console.log(`CDSE TOKEN FAIL: HTTP ${tokenRes.status} — ${(await tokenRes.text()).slice(0, 300)}`);
    return;
  }
  const token = (await tokenRes.json()).access_token;
  console.log('CDSE TOKEN: OK');

  // Process API: SLSTR S7 brightness temperature over Plzeň bbox, last 72 h
  const now = new Date();
  const from = new Date(now.getTime() - 72 * 3600 * 1000).toISOString();
  const evalscript = [
    '//VERSION=3',
    'function setup() { return { input: ["S7"], output: { bands: 1, sampleType: "UINT8" } }; }',
    'function evaluatePixel(s) {',
    '  if (!(s.S7 > 180 && s.S7 < 400)) return [255];',
    '  const c = s.S7 - 273.15;',
    '  return [Math.max(0, Math.min(250, Math.round(((c + 10) / 70) * 250)))];',
    '}',
  ].join('\n');
  const procRes = await fetch('https://sh.dataspace.copernicus.eu/api/v1/process', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, Accept: 'image/png' },
    body: JSON.stringify({
      input: {
        bounds: { bbox: [13.3, 49.706, 13.49, 49.8], properties: { crs: 'http://www.opengis.net/def/crs/EPSG/0/4326' } },
        data: [{ type: 'S3SLSTR', dataFilter: { timeRange: { from, to: now.toISOString() } } }],
      },
      output: { width: 52, height: 36, responses: [{ identifier: 'default', format: { type: 'image/png' } }] },
      evalscript,
    }),
    signal: AbortSignal.timeout(30000),
  });
  if (!procRes.ok) {
    console.log(`CDSE PROCESS FAIL: HTTP ${procRes.status} — ${(await procRes.text()).slice(0, 400)}`);
    return;
  }
  const buf = Buffer.from(await procRes.arrayBuffer());
  console.log(`CDSE PROCESS: OK — PNG ${buf.length} bytes`);
  // decode mean via pngjs
  const img = PNG.sync.read(buf);
  let valid = 0, sum = 0, min = 999, max = -999;
  for (let i = 0; i < img.width * img.height; i++) {
    const b = img.data[i * 4];
    if (b >= 251) continue;
    const c = (b / 250) * 70 - 10;
    valid++; sum += c; if (c < min) min = c; if (c > max) max = c;
  }
  if (valid > 0) {
    console.log(`SLSTR S7 (Plzeň, 72 h): valid cells ${valid}/${img.width * img.height}, mean ${(sum / valid).toFixed(1)} °C, range ${min.toFixed(1)}…${max.toFixed(1)} °C`);
  } else {
    console.log('SLSTR S7: 0 valid cells (clouds/nodata in 72 h window) — token + request shape OK');
  }
}

async function openrouterTest(): Promise<void> {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      'HTTP-Referer': 'https://github.com/SimonCurda/Susice26',
      'X-Title': 'Chladnejsi kraj',
    },
    body: JSON.stringify({
      model: 'deepseek/deepseek-v4.1-flash-1017',
      messages: [
        { role: 'system', content: 'Jsi testovací asistent. Odpověz jednou větou v češtině.' },
        { role: 'user', content: 'Řekni jednu větu: proč je stín stromů v horku důležitý.' },
      ],
      max_tokens: 100,
      temperature: 0.3,
    }),
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) {
    console.log(`OPENROUTER FAIL: HTTP ${res.status} — ${(await res.text()).slice(0, 300)}`);
    return;
  }
  const j = await res.json();
  const text = j?.choices?.[0]?.message?.content?.trim() ?? '';
  console.log(`OPENROUTER OK (model ${j?.model ?? 'unknown'}): ${text.slice(0, 200)}`);
}

await cdseTest();
await openrouterTest();
