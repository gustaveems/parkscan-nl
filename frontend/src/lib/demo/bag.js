// PDOK BAG integration.
//
// Today we use two layers:
//
// 1) PDOK Locatieserver `/reverse` — FREE, no key, returns real Dutch
//    addresses + BAG VBO IDs + postcode + coordinates within a radius of a
//    point. This is the primary "find candidate sites in an area" source.
//
// 2) BAG Individuele Bevragingen API — requires an API key. Returns
//    gebruiksdoel, oppervlakte, bouwjaar, pand-status. When BAG_API_KEY is
//    present, enrichBagDetails() uses it. Otherwise we fall back to
//    deterministic synthetic values per-site so the product still renders.

const LOCATIESERVER_BASE =
  "https://api.pdok.nl/bzk/locatieserver/search/v3_1";
const BAG_BEVRAGINGEN_BASE =
  process.env.BAG_BEVRAGINGEN_BASE ||
  "https://api.bag.kadaster.nl/lvbag/individuelebevragingen/v2";

const USE_PURPOSES_SYNTH = [
  "kantoorfunctie",
  "winkelfunctie",
  "industriefunctie",
  "celfunctie",
  "gezondheidszorgfunctie",
  "logiesfunctie",
  "onderwijsfunctie",
  "sportfunctie",
  "overige gebruiksfunctie",
];

const BAG_STATUSES_SYNTH = [
  "Pand in gebruik",
  "Pand in gebruik (niet ingemeten)",
  "Pand buiten gebruik",
  "Sloopvergunning verleend",
  "Verbouwing pand",
];

// ── Deterministic per-string PRNG ──────────────────────────────────────────
function stringSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function seededRandom(seed) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0xffffffff;
  };
}

function pick(arr, rng) {
  return arr[Math.floor(rng() * arr.length)];
}

// ── Utility: sample points inside a polygon ring for area queries ──────────
function pointInRing(lng, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersect =
      yi > lat !== yj > lat &&
      lng < ((xj - xi) * (lat - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function ringBbox(ring) {
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
  for (const [lng, lat] of ring) {
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  return { minLng, minLat, maxLng, maxLat };
}

function samplePointsInPolygon(ring, n, rng) {
  const bbox = ringBbox(ring);
  const out = [];
  let attempts = 0;
  const maxAttempts = n * 200;
  while (out.length < n && attempts < maxAttempts) {
    attempts++;
    const lng = bbox.minLng + rng() * (bbox.maxLng - bbox.minLng);
    const lat = bbox.minLat + rng() * (bbox.maxLat - bbox.minLat);
    if (pointInRing(lng, lat, ring)) out.push([lng, lat]);
  }
  while (out.length < n) {
    const cLng = (bbox.minLng + bbox.maxLng) / 2;
    const cLat = (bbox.minLat + bbox.maxLat) / 2;
    out.push([cLng + (rng() - 0.5) * 0.001, cLat + (rng() - 0.5) * 0.001]);
  }
  return out;
}

// ── Locatieserver /reverse ─────────────────────────────────────────────────
const REVERSE_CACHE = new Map();
const REVERSE_TTL_MS = 1000 * 60 * 30; // 30 min

function parsePoint(centroideLl) {
  // Example: "POINT(4.89507002 52.37315442)" — note: lon first.
  if (!centroideLl) return null;
  const m = /POINT\(([-0-9.eE]+)\s+([-0-9.eE]+)\)/.exec(centroideLl);
  if (!m) return null;
  return { lng: Number(m[1]), lat: Number(m[2]) };
}

/**
 * Reverse geocode at (lat, lng): return the nearest Dutch addresses.
 *
 * @param {number} lat
 * @param {number} lng
 * @param {{ distance?: number, rows?: number }} [opts]
 *   distance — max radius in meters (default 120)
 *   rows — max addresses to return (default 20)
 */
export async function reverseGeocode(lat, lng, opts = {}) {
  const distance = opts.distance ?? 120;
  const rows = opts.rows ?? 20;
  const key = `${lat.toFixed(4)},${lng.toFixed(4)}|${distance}|${rows}`;
  const hit = REVERSE_CACHE.get(key);
  if (hit && Date.now() - hit.at < REVERSE_TTL_MS) return hit.data;

  const url =
    `${LOCATIESERVER_BASE}/reverse` +
    `?lat=${lat}&lon=${lng}` +
    `&distance=${distance}` +
    `&rows=${rows}` +
    `&fq=type:adres` +
    `&fl=id,weergavenaam,adresseerbaarobject_id,nummeraanduiding_id,` +
    `straatnaam,huisnummer,huisletter,huisnummertoevoeging,postcode,` +
    `woonplaatsnaam,gemeentenaam,centroide_ll,afstand` +
    `&wt=json`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Locatieserver reverse ${res.status}: ${res.statusText}`);
  }
  const json = await res.json();
  const docs = json?.response?.docs || [];
  REVERSE_CACHE.set(key, { data: docs, at: Date.now() });
  if (REVERSE_CACHE.size > 2000) {
    const k = REVERSE_CACHE.keys().next().value;
    REVERSE_CACHE.delete(k);
  }
  return docs;
}

// ── BAG Individuele Bevragingen (paid, optional) ───────────────────────────
export function bagBevragingenEnabled() {
  return Boolean(process.env.BAG_API_KEY);
}

/**
 * Fetch detailed BAG data for a verblijfsobject (VBO) identificatie.
 * Returns { gebruiksdoel, oppervlakte, bouwjaar, pandStatus } or null.
 *
 * Requires BAG_API_KEY env var. Otherwise returns null; callers should fall
 * back to synthetic values.
 */
export async function fetchVboDetails(vboId) {
  if (!bagBevragingenEnabled()) return null;
  try {
    const url = `${BAG_BEVRAGINGEN_BASE}/verblijfsobjecten/${vboId}`;
    const res = await fetch(url, {
      headers: {
        "X-Api-Key": process.env.BAG_API_KEY,
        "Accept-Crs": "epsg:28992",
        Accept: "application/hal+json",
      },
    });
    if (!res.ok) return null;
    const json = await res.json();
    // Response shape varies by version. Defensive extraction.
    const vbo = json?.verblijfsobject?.verblijfsobject || json?.verblijfsobject || json;
    const gebruiksdoel = Array.isArray(vbo?.gebruiksdoelen)
      ? vbo.gebruiksdoelen[0]
      : vbo?.gebruiksdoel;
    const oppervlakte = vbo?.oppervlakte ?? null;
    const pandStatus = vbo?.status ?? null;
    const pandId = vbo?.maaktDeelUitVan?.[0] || vbo?.pandIdentificaties?.[0];
    let bouwjaar = null;
    if (pandId) {
      const pres = await fetch(
        `${BAG_BEVRAGINGEN_BASE}/panden/${pandId}`,
        {
          headers: {
            "X-Api-Key": process.env.BAG_API_KEY,
            "Accept-Crs": "epsg:28992",
            Accept: "application/hal+json",
          },
        }
      );
      if (pres.ok) {
        const pjson = await pres.json();
        const pand = pjson?.pand?.pand || pjson?.pand || pjson;
        bouwjaar = pand?.oorspronkelijkBouwjaar ?? null;
      }
    }
    return { gebruiksdoel, oppervlakte, bouwjaar, pandStatus };
  } catch (err) {
    if (process.env.NODE_ENV !== "test") {
      console.warn(`[bag] fetchVboDetails failed for ${vboId}:`, err.message);
    }
    return null;
  }
}

// ── Candidate site generation for an area ──────────────────────────────────

/**
 * Given an area (polygon/circle/district), return a list of candidate site
 * records using real Dutch address data from PDOK.
 *
 * The returned shape matches the legacy `generateSitesForScan` so no other
 * code needs to change.
 *
 * If BAG_API_KEY is present we also enrich with gebruiksdoel/oppervlakte/
 * bouwjaar. Otherwise those fields are synthesized deterministically per
 * site so the product still has something to render.
 */
export async function findSitesInArea({
  scanId,
  city,
  district,
  cityCenter, // [lat, lng]
  area,       // { type, geometry, center?, radiusM? } | null
  count = 24,
}) {
  const rngSeed = stringSeed(`${scanId}|${city}|${district || ""}|${area?.type || "district"}`);
  const rng = seededRandom(rngSeed);

  // Decide how to query: prefer direct center+distance for circle/district,
  // otherwise sample points across the polygon.
  let candidates = [];

  if (area?.type === "circle" && area?.center) {
    const [lat, lng] = [area.center[1] ?? area.center.lat, area.center[0] ?? area.center.lng];
    candidates = await reverseGeocode(lat, lng, {
      distance: area.radiusM ?? 500,
      rows: Math.min(50, count * 3),
    });
  } else if (area?.geometry?.type === "Polygon") {
    const ring = area.geometry.coordinates[0];
    // Sample a handful of anchor points, union their reverse-geocode
    // results, and filter to those inside the polygon.
    const anchors = samplePointsInPolygon(ring, Math.min(6, Math.ceil(count / 4)), rng);
    const results = await Promise.all(
      anchors.map(([lng, lat]) =>
        reverseGeocode(lat, lng, { distance: 150, rows: 20 }).catch(() => [])
      )
    );
    const seenIds = new Set();
    for (const docs of results) {
      for (const d of docs) {
        const p = parsePoint(d.centroide_ll);
        if (!p) continue;
        if (!pointInRing(p.lng, p.lat, ring)) continue;
        if (seenIds.has(d.id)) continue;
        seenIds.add(d.id);
        candidates.push(d);
      }
    }
  } else {
    // District preset — use city center with a wide distance.
    const [lat, lng] = cityCenter;
    candidates = await reverseGeocode(lat, lng, {
      distance: 900,
      rows: Math.min(50, count * 3),
    });
  }

  // Dedupe by (straatnaam + huisnummer) so we don't pick 20 apartments in
  // the same block (each flat is its own VBO).
  const byBuilding = new Map();
  for (const d of candidates) {
    const houseKey = `${(d.straatnaam || "").toLowerCase()}|${d.huisnummer || ""}`;
    if (!houseKey || houseKey === "|") continue;
    if (byBuilding.has(houseKey)) continue;
    byBuilding.set(houseKey, d);
  }
  let unique = [...byBuilding.values()];

  // Shuffle deterministically and take `count`.
  for (let i = unique.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [unique[i], unique[j]] = [unique[j], unique[i]];
  }
  unique = unique.slice(0, count);

  // Optionally enrich each with BAG details when a key is configured.
  const enrichments = await Promise.all(
    unique.map((d) =>
      bagBevragingenEnabled() && d.adresseerbaarobject_id
        ? fetchVboDetails(d.adresseerbaarobject_id)
        : Promise.resolve(null)
    )
  );

  return unique.map((d, i) => {
    const p = parsePoint(d.centroide_ll);
    const lat = p?.lat ?? cityCenter[0];
    const lng = p?.lng ?? cityCenter[1];
    const siteRng = seededRandom(stringSeed(`${scanId}|${d.id}`));

    const enr = enrichments[i] || {};
    const usePurpose = enr.gebruiksdoel || pick(USE_PURPOSES_SYNTH, siteRng);
    const areaSqm = enr.oppervlakte ?? Math.floor(siteRng() * 2400 + 200);
    const buildYear = enr.bouwjaar ?? Math.floor(siteRng() * 80 + 1940);
    const bagStatus =
      enr.pandStatus ||
      (siteRng() < 0.7
        ? BAG_STATUSES_SYNTH[0]
        : pick(BAG_STATUSES_SYNTH.slice(1), siteRng));

    const houseNumber = [
      d.huisnummer ?? "",
      d.huisletter ?? "",
      d.huisnummertoevoeging ? `-${d.huisnummertoevoeging}` : "",
    ].join("") || null;

    return {
      id: `site_${scanId}_${i}`,
      scanId,
      city,
      district: district || d.gemeentenaam || null,
      address: d.weergavenaam,
      street: d.straatnaam || "",
      houseNumber,
      postcode: d.postcode || "",
      lat,
      lng,
      bagId: d.adresseerbaarobject_id
        ? `NL.IMBAG.Verblijfsobject.${d.adresseerbaarobject_id}`
        : d.id,
      parcelRef: d.adresseerbaarobject_id || "",
      buildYear,
      usePurpose,
      areaSqm,
      bagStatus,
      status: "identified",
      source: enrichments[i] ? "pdok_bag" : "pdok_locatieserver",
      enriched: Boolean(enrichments[i]),
      createdAt: new Date().toISOString(),
    };
  });
}
