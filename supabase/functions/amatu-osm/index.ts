// Amatu Maps · Overpass proxy (OpenStreetMap POI search) for amatu-id.github.io/maps.
// Some Indonesian mobile networks get "406 Not Acceptable" or time-outs from overpass-api.de, so the page asks this
// function first; it tries the public Overpass mirrors in turn from Supabase's network and caches answers 15 min.
// Deploy (project amatu-id):
//   supabase functions deploy amatu-osm --project-ref ieyqxmzztoxgpvwexbkj --no-verify-jwt --use-api
//
// POST {q: "<Overpass QL>"}  → Overpass JSON ({elements:[…]}), header x-osm-src = mirror used, x-osm-cache = hit|miss
// GET  /ping                 → {ok:true}

const MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];
const UA = 'AmatuMaps/1.0 (+https://amatu-id.github.io/maps/)';
const MAX_Q = 60_000;            // along-route queries are a union of bboxes, can be long
const TTL = 15 * 60_000;
const ALLOW = /^(https:\/\/(amatu-id|liemyo)\.github\.io|https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?)$/;

const cors = (o: string) => ({
  'Access-Control-Allow-Origin': o || '*',
  'Access-Control-Allow-Headers': 'content-type, apikey, authorization, x-client-info',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Expose-Headers': 'x-osm-src, x-osm-cache',
  'Vary': 'Origin',
});

const cache = new Map<string, { t: number; body: string; src: string }>();
let bad: Record<string, number> = {};     // mirror → time until which it is skipped

async function sha(s: string) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
}

async function ask(q: string, deadline: number) {
  const order = MIRRORS.slice().sort((a, b) => (bad[a] || 0) - (bad[b] || 0));
  let last = 'no mirror';
  for (const ep of order) {
    const left = deadline - Date.now();
    if (left < 2500) break;
    if ((bad[ep] || 0) > Date.now() && ep !== order[order.length - 1]) continue;
    const ac = new AbortController();
    const tm = setTimeout(() => ac.abort(), Math.min(left, 28_000));
    try {
      const r = await fetch(ep, {
        method: 'POST', signal: ac.signal,
        headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
        body: 'data=' + encodeURIComponent(q),
      });
      const t = await r.text();
      if (r.ok && t.trimStart().startsWith('{')) {
        const j = JSON.parse(t);
        // Overpass reports server-side time-outs inside a 200 answer ("remark": "runtime error: …")
        if (j.remark && /runtime error|timed out|out of memory/i.test(j.remark) && !(j.elements || []).length) throw new Error(j.remark);
        return { body: t, src: new URL(ep).host };
      }
      last = ep + ' ' + r.status;
      bad[ep] = Date.now() + (r.status === 429 || r.status === 406 ? 120_000 : 30_000);
    } catch (e) {
      last = ep + ' ' + (e instanceof Error ? e.message : String(e));
      bad[ep] = Date.now() + 30_000;
    } finally { clearTimeout(tm); }
  }
  throw new Error(last);
}

Deno.serve(async req => {
  const origin = req.headers.get('origin') || '';
  const h = cors(ALLOW.test(origin) ? origin : '');
  if (req.method === 'OPTIONS') return new Response('ok', { headers: h });
  const url = new URL(req.url);
  if (req.method === 'GET' && url.pathname.endsWith('/ping')) return Response.json({ ok: true }, { headers: h });
  if (origin && !ALLOW.test(origin)) return Response.json({ error: 'origin' }, { status: 403, headers: h });
  if (req.method !== 'POST') return Response.json({ error: 'method' }, { status: 405, headers: h });
  let q = '';
  try { q = String((await req.json()).q || ''); } catch { /* empty */ }
  if (!q || q.length > MAX_Q || !/^\s*\[out:json\]/.test(q)) return Response.json({ error: 'query' }, { status: 400, headers: h });
  const key = await sha(q);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < TTL)
    return new Response(hit.body, { headers: { ...h, 'Content-Type': 'application/json', 'x-osm-src': hit.src, 'x-osm-cache': 'hit' } });
  try {
    const r = await ask(q, Date.now() + 55_000);
    cache.set(key, { t: Date.now(), ...r });
    if (cache.size > 300) for (const k of [...cache.keys()].slice(0, 100)) cache.delete(k);
    return new Response(r.body, { headers: { ...h, 'Content-Type': 'application/json', 'x-osm-src': r.src, 'x-osm-cache': 'miss' } });
  } catch (e) {
    return Response.json({ error: 'overpass', detail: e instanceof Error ? e.message : String(e) }, { status: 502, headers: h });
  }
});
