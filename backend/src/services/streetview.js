// Street View Metadata API — free availability check.
// Use before paying for a Street View Static request to avoid "no imagery"
// placeholders and unnecessary charges.

const CACHE = new Map();
const CACHE_TTL_MS = 1000 * 60 * 60 * 24; // 24h

function ck(lat, lng) {
  const r = (x) => Math.round(x * 1e4) / 1e4;
  return `${r(lat)},${r(lng)}`;
}

/**
 * Ask Street View Metadata if imagery exists near (lat, lng).
 * Free API — ~unlimited quota.
 *
 * @returns {Promise<{ status: 'OK'|'ZERO_RESULTS'|'NOT_FOUND'|'REQUEST_DENIED'|'OVER_QUERY_LIMIT'|string, panoId?: string, date?: string }>}
 */
export async function fetchStreetViewMetadata(lat, lng) {
  const key =
    process.env.GOOGLE_STREET_VIEW_STATIC_API_KEY ||
    process.env.GOOGLE_MAPS_API_KEY;
  if (!key) throw new Error("GOOGLE_MAPS_API_KEY not configured");

  const cacheKey = ck(lat, lng);
  const cached = CACHE.get(cacheKey);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return { ...cached.data, cached: true };
  }

  const url = new URL("https://maps.googleapis.com/maps/api/streetview/metadata");
  url.searchParams.set("location", `${lat},${lng}`);
  url.searchParams.set("key", key);

  const res = await fetch(url.toString());
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`StreetView metadata ${res.status}: ${text || res.statusText}`);
  }

  const json = await res.json();
  const data = {
    status: json.status || "UNKNOWN",
    panoId: json.pano_id || null,
    date: json.date || null,
  };

  CACHE.set(cacheKey, { data, at: Date.now() });
  if (CACHE.size > 5000) {
    const firstKey = CACHE.keys().next().value;
    CACHE.delete(firstKey);
  }
  return data;
}
