// Mock Dutch building data seeded per district
// In production: replace with PDOK BAG OGC API calls

export const DISTRICTS = {
  amsterdam: {
    name: "Amsterdam",
    center: [52.3676, 4.9041],
    districts: ["Centrum", "West", "Noord", "Oost", "Zuid", "Nieuw-West", "Zuidoost"],
  },
  rotterdam: {
    name: "Rotterdam",
    center: [51.9225, 4.4792],
    districts: ["Centrum", "Noord", "Zuid", "West", "Feijenoord", "IJsselmonde", "Hillegersberg"],
  },
  utrecht: {
    name: "Utrecht",
    center: [52.0907, 5.1214],
    districts: ["Binnenstad", "Oost", "Noord", "West", "Zuid", "Vleuten-De Meern"],
  },
};

const USE_PURPOSES = [
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

const BAG_STATUSES = [
  "Pand in gebruik",
  "Pand in gebruik (niet ingemeten)",
  "Pand buiten gebruik",
  "Sloopvergunning verleend",
  "Verbouwing pand",
];

const STREET_NAMES_AMS = [
  "Prinsengracht", "Herengracht", "Keizersgracht", "Singel", "Westerstraat",
  "Haarlemmerstraat", "Jordaanstraat", "Overtoom", "De Clercqstraat", "Kinkerstraat",
  "Haarlemmerdijk", "Spuistraat", "Damstraat", "Rokin", "Kalverstraat",
];
const STREET_NAMES_ROT = [
  "Coolsingel", "Blaak", "Meent", "Lijnbaan", "Karel Doormanstraat",
  "West-Kruiskade", "Schiedamse Vest", "Nieuwe Binnenweg", "Witte de Withstraat",
];
const STREET_NAMES_UTR = [
  "Oudegracht", "Nieuwegracht", "Lange Viestraat", "Vredenburg", "Catharijnekade",
  "Wittevrouwenstraat", "Zadelstraat", "Nachtegaalstraat", "Amsterdamsestraatweg",
];

const STREET_NAMES = {
  amsterdam: STREET_NAMES_AMS,
  rotterdam: STREET_NAMES_ROT,
  utrecht: STREET_NAMES_UTR,
};

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

function stringSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// Ray-casting point-in-polygon for a GeoJSON Polygon outer ring ([[lng, lat], ...]).
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

// Sample n random points that fall inside the supplied GeoJSON Polygon geometry.
function samplePointsInPolygon(geometry, n, rng) {
  const ring = geometry.coordinates[0];
  const { minLng, minLat, maxLng, maxLat } = ringBbox(ring);
  const out = [];
  let attempts = 0;
  const maxAttempts = n * 200;
  while (out.length < n && attempts < maxAttempts) {
    attempts++;
    const lng = minLng + rng() * (maxLng - minLng);
    const lat = minLat + rng() * (maxLat - minLat);
    if (pointInRing(lng, lat, ring)) out.push([lng, lat]);
  }
  // Fallback: if the polygon was too thin to sample enough, jitter centroid.
  while (out.length < n) {
    const cLng = (minLng + maxLng) / 2;
    const cLat = (minLat + maxLat) / 2;
    out.push([cLng + (rng() - 0.5) * 0.001, cLat + (rng() - 0.5) * 0.001]);
  }
  return out;
}

export function generateSitesForScan(scanId, city, district, count = 24, area = null) {
  const cityData = DISTRICTS[city];
  const seedSource = `${scanId}|${district || ''}|${area?.type || ''}`;
  const rng = seededRandom(stringSeed(seedSource));
  const streets = STREET_NAMES[city] || STREET_NAMES_AMS;
  const [baseLat, baseLng] = cityData.center;

  // Compute [lng, lat] positions for each candidate.
  let positions;
  if (area?.geometry?.type === 'Polygon') {
    positions = samplePointsInPolygon(area.geometry, count, rng);
  } else {
    positions = Array.from({ length: count }, () => [
      baseLng + (rng() - 0.5) * 0.06,
      baseLat + (rng() - 0.5) * 0.06,
    ]);
  }

  return positions.map(([lng, lat], i) => {
    const r = () => rng();
    const bagId = `NL.IMBAG.Pand.${Math.floor(r() * 9e11 + 1e11)}`;
    const parcelRef = `${city.slice(0, 2).toUpperCase()}${String(Math.floor(r() * 99 + 1)).padStart(2, "0")} ${String(Math.floor(r() * 9999 + 1000))} ${String(Math.floor(r() * 9999 + 1000)).padStart(4, "0")}`;
    const street = pick(streets, r);
    const houseNum = Math.floor(r() * 200 + 1);
    const postcode = `${Math.floor(r() * 9000 + 1000)}${String.fromCharCode(65 + Math.floor(r() * 26))}${String.fromCharCode(65 + Math.floor(r() * 26))}`;
    const buildYear = Math.floor(r() * 80 + 1940);
    const usePurpose = pick(USE_PURPOSES, r);
    const areaSqm = Math.floor(r() * 2400 + 200);
    const bagStatus = r() < 0.7 ? BAG_STATUSES[0] : pick(BAG_STATUSES.slice(1), r);

    return {
      id: `site_${scanId}_${i}`,
      scanId,
      city,
      district: district || null,
      address: `${street} ${houseNum}, ${postcode} ${cityData.name}`,
      street,
      houseNumber: houseNum,
      postcode,
      lat,
      lng,
      bagId,
      parcelRef,
      buildYear,
      usePurpose,
      areaSqm,
      bagStatus,
      status: "identified",
      createdAt: new Date().toISOString(),
    };
  });
}

export function generateStreetViewUrl(lat, lng) {
  // IMPORTANT: do not embed Google API keys in client-facing URLs.
  // We proxy images through the backend so keys stay server-side.
  const heading = Math.floor(Math.random() * 360);
  return `/api/maps/streetview?lat=${encodeURIComponent(lat)}&lng=${encodeURIComponent(lng)}&heading=${encodeURIComponent(heading)}&pitch=10&fov=80&size=640x400`;
}

export function generateMapImageUrl(lat, lng) {
  return `/api/maps/static?lat=${encodeURIComponent(lat)}&lng=${encodeURIComponent(lng)}&zoom=17&size=640x400&maptype=roadmap`;
}

export function generateNearbyPOIs(lat, lng, rng2) {
  const r = rng2 || seededRandom(Math.floor(lat * 1000 + lng * 100));
  const categories = ["transit_station", "restaurant", "retail", "hospital", "parking", "hotel", "office"];
  const count = Math.floor(r() * 15 + 2);
  return {
    totalCount: count,
    transitProximity: r() < 0.6,
    hospitalProximity: r() < 0.3,
    retailProximity: r() < 0.7,
    categories: categories.filter(() => r() > 0.4),
  };
}

// A realistic spread of Dutch rechtspersonen across categories: institutional
// investors, developers, family offices, REITs, municipalities, housing
// corporations, and private individuals. Roughly weighted so institutional
// investors don't dominate the distribution.
const OWNER_POOL = [
  // Institutional / REIT
  { name: "Amvest BV", type: "institutional" },
  { name: "Bouwinvest REIM BV", type: "institutional" },
  { name: "Syntrus Achmea Real Estate", type: "institutional" },
  { name: "ING Real Estate BV", type: "institutional" },
  { name: "CBRE Global Investors", type: "institutional" },
  { name: "Patrizia Netherlands BV", type: "institutional" },
  { name: "Greystar Real Estate BV", type: "institutional" },
  { name: "Round Hill Capital Netherlands", type: "institutional" },
  { name: "a.s.r. real estate", type: "institutional" },
  // Developers / vastgoed
  { name: "Bouwfonds Property Development", type: "developer" },
  { name: "Volker Wessels Vastgoed", type: "developer" },
  { name: "AM BV", type: "developer" },
  { name: "Heijmans Vastgoed BV", type: "developer" },
  { name: "Ballast Nedam Ontwikkelingsmaatschappij", type: "developer" },
  { name: "OVG Real Estate BV", type: "developer" },
  { name: "Dura Vermeer Bouw Rotterdam BV", type: "developer" },
  { name: "BPD Ontwikkeling BV", type: "developer" },
  // Housing corporations (corporaties)
  { name: "Woonstad Rotterdam", type: "corporation" },
  { name: "Havensteder", type: "corporation" },
  { name: "Ymere", type: "corporation" },
  { name: "Stadgenoot", type: "corporation" },
  { name: "Mitros", type: "corporation" },
  { name: "Portaal", type: "corporation" },
  // Heritage / stichting
  { name: "Stichting Stadsherstel Amsterdam", type: "foundation" },
  { name: "Stichting Hendrick de Keyser", type: "foundation" },
  // Municipalities / public
  { name: "Gemeente Amsterdam", type: "public" },
  { name: "Gemeente Rotterdam", type: "public" },
  { name: "Gemeente Utrecht", type: "public" },
  { name: "Gemeente Den Haag", type: "public" },
  { name: "NS Stations BV", type: "public" },
  { name: "ProRail BV", type: "public" },
  // Family / small BV
  { name: "Vastgoed Beheer Nederland BV", type: "private_bv" },
  { name: "Van Gelder Vastgoed BV", type: "private_bv" },
  { name: "De Boer Holding BV", type: "private_bv" },
  { name: "Jansen Onroerend Goed BV", type: "private_bv" },
  { name: "De Vries Vastgoed Groep BV", type: "private_bv" },
  // Private individuals (Kadaster hides the name at the API level)
  { name: "Privépersoon (naam beschikbaar via Kadaster)", type: "private" },
  { name: "Privépersoon (naam beschikbaar via Kadaster)", type: "private" },
];

// Simple FNV-1a-based string hash so every unique input seeds a different
// random stream. Previously we derived the seed from bagId.charCodeAt(8),
// which was always '.' for real PDOK BAG IDs (NL.IMBAG.*) and collapsed the
// owner distribution onto a handful of names.
function hashString(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function generateOwnership(site) {
  // Mix siteId + bagId + lat/lng so every site gets an independent stream,
  // even when bagIds share a long prefix (e.g. NL.IMBAG.Verblijfsobject.*).
  const seedSource = `${site.id}|${site.bagId || ""}|${site.lat}|${site.lng}`;
  const rng = seededRandom(hashString(seedSource));
  const r = () => rng();
  const owner = pick(OWNER_POOL, r);

  // Different owner categories typically hold property differently.
  let ownershipType;
  if (owner.type === "public") {
    ownershipType = r() < 0.7 ? "Eigendom" : "Erfpacht";
  } else if (owner.type === "corporation" || owner.type === "foundation") {
    ownershipType = r() < 0.85 ? "Eigendom" : "Erfpacht";
  } else {
    ownershipType = r() < 0.55 ? "Eigendom" : r() < 0.85 ? "Erfpacht" : "Opstalrecht";
  }

  // Municipalities and foundations almost always have high-confidence records.
  const ownershipConfidence =
    owner.type === "public" || owner.type === "corporation" || owner.type === "foundation"
      ? "high"
      : r() < 0.7
      ? "high"
      : r() < 0.9
      ? "medium"
      : "low";

  const restrictions = [];
  if (owner.type === "private_bv" || owner.type === "developer" || owner.type === "institutional") {
    if (r() < 0.45) restrictions.push("Hypotheek gevestigd");
    if (r() < 0.15) restrictions.push("Kwalitatieve verplichting");
  } else if (owner.type === "corporation") {
    if (r() < 0.25) restrictions.push("Hypotheek gevestigd");
  } else if (owner.type === "foundation") {
    if (r() < 0.5) restrictions.push("Monumentenstatus");
  }

  return {
    ownerName: owner.name,
    parcelRef: site.parcelRef,
    ownershipType,
    ownershipConfidence,
    restrictions,
    retrievedAt: new Date().toISOString(),
    source: "kadaster",
  };
}
