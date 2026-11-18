// Amatu Maps · short map links → full link, for amatu-id.github.io/maps.
// Google Maps' "Bagikan → Salin link" gives https://maps.app.goo.gl/<id>. The page cannot read where a short link points
// (the browser hides cross-origin redirects), so this function asks the link shortener and returns its Location header,
// e.g. https://www.google.com/maps/place/Send2+Laundry+Magelang/@…!3d-7.4818036!4d110.2300487. The page reads the
// place name and coordinates from that URL itself. Only shortener hosts are contacted — never a Google Maps page.
// Deploy (project amatu-id):
//   supabase functions deploy amatu-link --project-ref ieyqxmzztoxgpvwexbkj --no-verify-jwt --use-api
//
// GET ?u=<short link>  → {ok:true, url:"<where it points>"}  |  {ok:false, error}
// GET /ping            → {ok:true}

const ALLOW = /^(https:\/\/(amatu-id|liemyo)\.github\.io|https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?)$/;
// link shorteners of map apps (Google Maps share links, Google Business g.page, Apple Maps maps.apple)
const SHORT = /^(maps\.app\.goo\.gl|goo\.gl|g\.page|g\.co|share\.google|maps\.apple)$/i;
const UA = 'Mozilla/5.0 (compatible; AmatuMaps/1.0; +https://amatu-id.github.io/maps/)';
const TTL = 30 * 864e5;

const cors = (o: string) => ({
  'Access-Control-Allow-Origin': o || '*',
  'Access-Control-Allow-Headers': 'content-type, apikey, authorization, x-client-info',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Vary': 'Origin',
});
const cache = new Map<string, { t: number; url: string }>();

async function expand(start: URL): Promise<string> {
  let url = start;
  for (let hop = 0; hop < 5; hop++) {
    const ac = new AbortController(), tm = setTimeout(() => ac.abort(), 8000);
    let loc: string | null = null, status = 0;
    try {
      const r = await fetch(url, { redirect: 'manual', signal: ac.signal, headers: { 'User-Agent': UA } });
      status = r.status; loc = r.headers.get('location');
      await r.body?.cancel();
    } finally { clearTimeout(tm); }
    if (!loc) throw new Error(status === 404 ? 'notfound' : 'nolocation ' + status);
    const next = new URL(loc, url);
    if (!SHORT.test(next.hostname)) return next.href;      // left the shortener: this is the real link
    url = next;
  }
  throw new Error('hops');
}

Deno.serve(async req => {
  const origin = req.headers.get('origin') || '';
  const h = cors(ALLOW.test(origin) ? origin : '');
  if (req.method === 'OPTIONS') return new Response('ok', { headers: h });
  const u = new URL(req.url);
  if (u.pathname.endsWith('/ping')) return Response.json({ ok: true }, { headers: h });
  if (origin && !ALLOW.test(origin)) return Response.json({ ok: false, error: 'origin' }, { status: 403, headers: h });
  if (req.method !== 'GET') return Response.json({ ok: false, error: 'method' }, { status: 405, headers: h });
  let link: URL;
  try { link = new URL(String(u.searchParams.get('u') || '').trim()); } catch { return Response.json({ ok: false, error: 'url' }, { status: 400, headers: h }); }
  if (link.protocol !== 'https:' && link.protocol !== 'http:') return Response.json({ ok: false, error: 'url' }, { status: 400, headers: h });
  if (!SHORT.test(link.hostname)) return Response.json({ ok: false, error: 'host' }, { status: 400, headers: h });
  link.protocol = 'https:';
  const key = link.href;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < TTL) return Response.json({ ok: true, url: hit.url, cache: 'hit' }, { headers: h });
  try {
    const url = await expand(link);
    cache.set(key, { t: Date.now(), url });
    if (cache.size > 2000) for (const k of [...cache.keys()].slice(0, 500)) cache.delete(k);
    return Response.json({ ok: true, url }, { headers: h });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ ok: false, error: msg }, { status: msg === 'notfound' ? 404 : 502, headers: h });
  }
});
