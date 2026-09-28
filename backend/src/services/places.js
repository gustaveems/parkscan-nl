// Google Places API (New) — Nearby Search wrapper.
// Returns the same shape as the legacy mock generateNearbyPOIs so the scoring
// engine keeps working unchanged.

// Categorisation of Places API types into the boolean flags + categories used
// by scoringEngine.js (transit/hospital/retail proximity, etc).
const TRANSIT_TYPES = new Set([
  "bus_station",
  "train_station",
  "subway_station",
  "light_rail_station",
  "transit_station",
  "taxi_stand",
]);
const HOSPITAL_TYPES = new Set([
  "hospital",
  "medical_clinic",
  "doctor",
]);
const RETAIL_TYPES = new Set([
  "shopping_mall",
  "department_store",
  "clothing_store",
  "convenience_store",
  "supermarket",
  "grocery_store",
  "bakery",
  "book_store",
  "electronics_store",
  "furniture_store",
  "home_goods_store",
  "jewelry_store",
  "shoe_store",
  "store",
  "liquor_store",
  "pharmacy",
]);
const HOTEL_TYPES = new Set(["lodging", "hotel"]);
const OFFICE_TYPES = new Set(["accounting", "bank", "lawyer", "real_estate_agency", "travel_agency"]);
const PARKING_TYPES = new Set(["parking"]);
const RESTAURANT_TYPES = new Set([
  "restaurant",
  "cafe",
  "bar",
  "meal_takeaway",
  "meal_delivery",
  "food",
]);

// Simple in-process TTL cache. Keyed by rounded lat/lng + radius so nearby
// sites share results. Places nearby data is stable for hours, so an hour
// of TTL in dev and one day in prod is safe.
const CACHE = new Map();
const CACHE_TTL_MS = 1000 * 60 * 60; // 1h

function cacheKey(lat, lng, radius) {
  const round = (x) => Math.round(x * 1e4) / 1e4; // ~10m precision
  return `${round(lat)},${round(lng)}|r${radius}`;
}

function getCached(key) {
  const entry = CACHE.get(key);
  if (!entry) return null;
  if (Date.now() - entry.at > CACHE_TTL_MS) {
    CACHE.delete(key);
    return null;
  }
  return entry.data;
}

function setCached(key, data) {
  CACHE.set(key, { data, at: Date.now() });
  // Cheap LRU: cap size.
  if (CACHE.size > 1000) {
    const firstKey = CACHE.keys().next().value;
    CACHE.delete(firstKey);
  }
}

function classify(places) {
  const categories = new Set();
  let transit = false, hospital = false, retail = false;

  for (const p of places) {
    for (const t of p.types || []) {
      if (TRANSIT_TYPES.has(t)) { transit = true; categories.add("transit_station"); }
      if (HOSPITAL_TYPES.has(t)) { hospital = true; categories.add("hospital"); }
      if (RETAIL_TYPES.has(t))   { retail = true;  categories.add("retail"); }
      if (HOTEL_TYPES.has(t))    categories.add("hotel");
      if (OFFICE_TYPES.has(t))   categories.add("office");
      if (PARKING_TYPES.has(t))  categories.add("parking");
      if (RESTAURANT_TYPES.has(t)) categories.add("restaurant");
    }
  }

  return {
    totalCount: places.length,
    transitProximity: transit,
    hospitalProximity: hospital,
    retailProximity: retail,
    categories: [...categories],
    source: "google_places",
  };
}

/**
 * Fetch nearby POI context via Places API (New) searchNearby.
 * Returns the same shape as mock generateNearbyPOIs; callers can use it
 * interchangeably.
 *
 * @param {number} lat
 * @param {number} lng
 * @param {{ radius?: number }} [opts]
 * @returns {Promise<{ totalCount, transitProximity, hospitalProximity, retailProximity, categories, source, places? }>}
 */
export async function fetchNearbyPOIs(lat, lng, opts = {}) {
  const radius = opts.radius ?? 250;
  const key =
    process.env.GOOGLE_PLACES_API_KEY ||
    process.env.GOOGLE_MAPS_API_KEY;
  if (!key) throw new Error("GOOGLE_MAPS_API_KEY not configured");

  const ck = cacheKey(lat, lng, radius);
  const cached = getCached(ck);
  if (cached) return { ...cached, cached: true };

  const body = {
    maxResultCount: 20,
    locationRestriction: {
      circle: {
        center: { latitude: lat, longitude: lng },
        radius,
      },
    },
  };

  const res = await fetch(
    "https://places.googleapis.com/v1/places:searchNearby",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": "places.types,places.displayName,places.location,places.primaryType",
      },
      body: JSON.stringify(body),
    }
  );

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const err = new Error(
      `Places API error ${res.status}: ${text || res.statusText}`
    );
    err.status = res.status;
    throw err;
  }

  const json = await res.json();
  const places = Array.isArray(json.places) ? json.places : [];
  const classified = classify(places);

  // Retain minimal place records so the UI can list them if needed.
  classified.places = places.map((p) => ({
    name: p.displayName?.text || "",
    types: p.types || [],
    primaryType: p.primaryType || null,
    lat: p.location?.latitude ?? null,
    lng: p.location?.longitude ?? null,
  }));

  setCached(ck, classified);
  return classified;
}

export function clearPlacesCache() {
  CACHE.clear();
}
