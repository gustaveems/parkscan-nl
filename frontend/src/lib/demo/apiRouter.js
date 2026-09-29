import { Router } from "./expressShim.js";
import { v4 as uuidv4 } from "./uuidShim.js";
import {
  DISTRICTS,
  generateSitesForScan,
  generateNearbyPOIs,
  generateOwnership,
  generateStreetViewUrl,
  generateMapImageUrl,
} from "./mockData.js";
import { scoresite, computeConversionModel } from "./scoringEngine.js";
import { renderReportPdf } from "./pdfShim.js";
import { fetchNearbyPOIs } from "./places.js";
import { fetchStreetViewMetadata } from "./streetview.js";
import { findSitesInArea, bagBevragingenEnabled } from "./bag.js";
import { analyzeFrontage, visionProvider } from "./vision.js";
import { getStore } from "./store.js";
import {
  approveAndSendOutreach,
  ensureOutreachDraft,
  getOutreachPolicyMeta,
  OUTREACH_ACTIVE_STATUSES,
  OUTREACH_REPLY_STATUSES,
  processOutreachQueueOnce,
  queueEligibleSitesForScan,
  retryOutreach,
  simulateReply,
  skipOutreach,
} from "./outreachAutomation.js";

// Try real Places API first; fall back to mock on any failure so the product
// still works if the key is missing, rate-limited, or the network hiccups.
async function getContext(site) {
  try {
    return await fetchNearbyPOIs(site.lat, site.lng);
  } catch (err) {
    if (process.env.NODE_ENV !== "test") {
      console.warn(
        `[places] fallback to mock for ${site.id} (${site.lat},${site.lng}):`,
        err.message
      );
    }
    return generateNearbyPOIs(site.lat, site.lng);
  }
}

const MANUAL_OUTREACH_STATUSES = new Set([
  "queued",
  "awaiting_approval",
  "failed",
  "skipped",
]);

async function hydrateOutreachItems(items, store, { scanId = null, status = null } = {}) {
  const hydrated = await Promise.all(
    items.map(async (outreach) => {
      const site = await store.sites.get(outreach.siteId);
      if (!site) return null;
      if (scanId && site.scanId !== scanId) return null;
      if (status && outreach.status !== status) return null;
      const [score, owner] = await Promise.all([
        store.scores.get(site.id),
        store.owners.get(site.id),
      ]);
      return { site, score, owner, outreach };
    }),
  );

  return hydrated
    .filter(Boolean)
    .sort((a, b) => (b.score?.vacancyScore ?? -1) - (a.score?.vacancyScore ?? -1));
}

const router = Router();

// ── Mock placeholder SVGs ────────────────────────────────────────────────────
// When GOOGLE_MAPS_API_KEY is missing (or upstream Google call fails) we serve
// a deterministic SVG instead of a 500. This keeps the README's promise that
// "the product still runs end-to-end with zero API keys" — the operator gets a
// labelled placeholder rather than broken-image icons in every report card.

function parseSize(s, def = "640x400") {
  const m = /^(\d+)x(\d+)$/.exec(typeof s === "string" ? s : def) || [];
  const w = Math.max(64, Math.min(1024, Number(m[1]) || 640));
  const h = Math.max(64, Math.min(1024, Number(m[2]) || 400));
  return { w, h };
}

function svgEscape(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function mockMapSvg({ lat, lng, size, label = "Mock Map" }) {
  const { w, h } = parseSize(size);
  const cx = w / 2;
  const cy = h / 2;
  const coord = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
      `<defs>` +
        `<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">` +
          `<stop offset="0%" stop-color="#1a2840"/>` +
          `<stop offset="100%" stop-color="#0f1828"/>` +
        `</linearGradient>` +
        `<pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">` +
          `<path d="M40 0 L0 0 0 40" fill="none" stroke="rgba(96,165,250,0.12)" stroke-width="1"/>` +
        `</pattern>` +
      `</defs>` +
      `<rect width="100%" height="100%" fill="url(#bg)"/>` +
      `<rect width="100%" height="100%" fill="url(#grid)"/>` +
      // Faux road traces
      `<path d="M0 ${cy + 30} Q ${cx} ${cy - 40}, ${w} ${cy + 10}" stroke="rgba(96,165,250,0.25)" stroke-width="3" fill="none"/>` +
      `<path d="M${cx - 80} 0 Q ${cx + 20} ${cy}, ${cx - 40} ${h}" stroke="rgba(96,165,250,0.18)" stroke-width="2" fill="none"/>` +
      // Pin marker
      `<circle cx="${cx}" cy="${cy}" r="8" fill="#ef4444" stroke="#fff" stroke-width="2"/>` +
      `<circle cx="${cx}" cy="${cy}" r="2.5" fill="#fff"/>` +
      // Captions
      `<text x="14" y="22" fill="#60a5fa" font-family="ui-monospace, monospace" font-size="12" font-weight="700">${svgEscape(label)}</text>` +
      `<text x="14" y="${h - 14}" fill="rgba(232,237,245,0.6)" font-family="ui-monospace, monospace" font-size="11">${svgEscape(coord)}</text>` +
      `<text x="${w - 14}" y="${h - 14}" fill="rgba(232,237,245,0.4)" font-family="ui-monospace, monospace" font-size="10" text-anchor="end">no GOOGLE_MAPS_API_KEY</text>` +
    `</svg>`
  );
}

function headingLabel(h) {
  const n = ((Number(h) % 360) + 360) % 360;
  if (n < 45 || n >= 315) return "N";
  if (n < 135) return "E";
  if (n < 225) return "S";
  return "W";
}

function mockStreetViewSvg({ lat, lng, size, heading = 0 }) {
  const { w, h } = parseSize(size);
  const cx = w / 2;
  const cy = h / 2;
  const dirShort = headingLabel(heading);
  const headingNum = ((Number(heading) % 360) + 360) % 360;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
      `<defs>` +
        `<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">` +
          `<stop offset="0%" stop-color="#3b4d6b"/>` +
          `<stop offset="55%" stop-color="#253045"/>` +
          `<stop offset="100%" stop-color="#161c27"/>` +
        `</linearGradient>` +
      `</defs>` +
      `<rect width="100%" height="100%" fill="url(#sky)"/>` +
      // Horizon
      `<line x1="0" y1="${cy + 20}" x2="${w}" y2="${cy + 20}" stroke="rgba(255,255,255,0.08)" stroke-width="1"/>` +
      // Faux building blocks
      `<rect x="${cx - 180}" y="${cy - 70}" width="120" height="90" fill="#1a2235" stroke="rgba(255,255,255,0.05)"/>` +
      `<rect x="${cx - 50}" y="${cy - 100}" width="100" height="120" fill="#202c40" stroke="rgba(255,255,255,0.05)"/>` +
      `<rect x="${cx + 60}" y="${cy - 50}" width="130" height="70" fill="#1e2736" stroke="rgba(255,255,255,0.05)"/>` +
      // Compass arrow
      `<g transform="translate(${cx}, ${cy + 70}) rotate(${headingNum})">` +
        `<polygon points="0,-26 8,8 0,2 -8,8" fill="#60a5fa" stroke="rgba(255,255,255,0.6)" stroke-width="1"/>` +
      `</g>` +
      // Direction badge top-left
      `<rect x="10" y="10" width="58" height="22" rx="4" fill="rgba(0,0,0,0.6)"/>` +
      `<text x="20" y="26" fill="#fff" font-family="ui-monospace, monospace" font-size="12" font-weight="700">${dirShort} · ${headingNum}°</text>` +
      // Caption
      `<text x="14" y="${h - 14}" fill="rgba(232,237,245,0.55)" font-family="ui-monospace, monospace" font-size="11">Mock Street View · ${svgEscape(lat.toFixed(4))},${svgEscape(lng.toFixed(4))}</text>` +
      `<text x="${w - 14}" y="${h - 14}" fill="rgba(232,237,245,0.35)" font-family="ui-monospace, monospace" font-size="10" text-anchor="end">no GOOGLE_MAPS_API_KEY</text>` +
    `</svg>`
  );
}

function sendSvg(res, svg, { cacheable = true } = {}) {
  res.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
  if (cacheable) res.setHeader("Cache-Control", "public, max-age=3600");
  res.end(svg);
}

// ── Google Maps image proxies (keep API key server-side) ─────────────────────
// When the key is absent OR the upstream call fails we serve a styled SVG
// placeholder instead of 500'ing — keeps every report-card image-tag working
// in mock mode (matches README's "Mock placeholder" promise).
router.get("/maps/static", async (req, res) => {
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return res.status(400).json({ error: "lat and lng are required numbers" });
  }

  const size = typeof req.query.size === "string" ? req.query.size : "640x400";
  const key = process.env.GOOGLE_MAPS_STATIC_API_KEY || process.env.GOOGLE_MAPS_API_KEY;
  if (!key) {
    return sendSvg(res, mockMapSvg({ lat, lng, size }));
  }

  const zoom = req.query.zoom ? Number(req.query.zoom) : 17;
  const maptype = typeof req.query.maptype === "string" ? req.query.maptype : "roadmap";

  const url = new URL("https://maps.googleapis.com/maps/api/staticmap");
  url.searchParams.set("center", `${lat},${lng}`);
  url.searchParams.set("zoom", String(Number.isFinite(zoom) ? zoom : 17));
  url.searchParams.set("size", size);
  url.searchParams.set("maptype", maptype);
  url.searchParams.set("markers", `color:red|${lat},${lng}`);
  url.searchParams.set("key", key);

  try {
    const r = await fetch(url.toString());
    if (!r.ok) {
      console.warn(`[maps/static] upstream ${r.status}; serving mock`);
      return sendSvg(res, mockMapSvg({ lat, lng, size, label: "Mock Map (upstream error)" }));
    }
    const ct = r.headers.get("content-type") || "image/png";
    res.setHeader("Content-Type", ct);
    res.setHeader("Cache-Control", "public, max-age=86400");
    const buf = Buffer.from(await r.arrayBuffer());
    res.end(buf);
  } catch (err) {
    console.warn(`[maps/static] fetch failed (${err.message}); serving mock`);
    sendSvg(res, mockMapSvg({ lat, lng, size, label: "Mock Map (fetch failed)" }));
  }
});

router.get("/maps/streetview", async (req, res) => {
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return res.status(400).json({ error: "lat and lng are required numbers" });
  }

  const heading = req.query.heading ? Number(req.query.heading) : 0;
  const size = typeof req.query.size === "string" ? req.query.size : "640x400";

  const key = process.env.GOOGLE_STREET_VIEW_STATIC_API_KEY || process.env.GOOGLE_MAPS_API_KEY;
  if (!key) {
    return sendSvg(res, mockStreetViewSvg({ lat, lng, size, heading }));
  }

  const pitch = req.query.pitch ? Number(req.query.pitch) : 10;
  const fov = req.query.fov ? Number(req.query.fov) : 80;

  const url = new URL("https://maps.googleapis.com/maps/api/streetview");
  url.searchParams.set("size", size);
  url.searchParams.set("location", `${lat},${lng}`);
  url.searchParams.set("heading", String(Number.isFinite(heading) ? heading : 0));
  url.searchParams.set("pitch", String(Number.isFinite(pitch) ? pitch : 10));
  url.searchParams.set("fov", String(Number.isFinite(fov) ? fov : 80));
  url.searchParams.set("key", key);

  try {
    const r = await fetch(url.toString());
    if (!r.ok) {
      console.warn(`[maps/streetview] upstream ${r.status}; serving mock`);
      return sendSvg(res, mockStreetViewSvg({ lat, lng, size, heading }));
    }
    const ct = r.headers.get("content-type") || "image/jpeg";
    res.setHeader("Content-Type", ct);
    res.setHeader("Cache-Control", "public, max-age=86400");
    const buf = Buffer.from(await r.arrayBuffer());
    res.end(buf);
  } catch (err) {
    console.warn(`[maps/streetview] fetch failed (${err.message}); serving mock`);
    sendSvg(res, mockStreetViewSvg({ lat, lng, size, heading }));
  }
});

// Cheap availability probe — Street View Metadata is free. Frontend can call
// this before rendering a Street View image to decide whether to show it.
// In mock mode (no key, or upstream failure) we return `available: true` so
// the gallery still renders our mock SVGs rather than the "no imagery" panel.
router.get("/maps/streetview/meta", async (req, res) => {
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return res.status(400).json({ error: "lat and lng are required numbers" });
  }
  const key =
    process.env.GOOGLE_STREET_VIEW_STATIC_API_KEY ||
    process.env.GOOGLE_MAPS_API_KEY;
  if (!key) {
    res.setHeader("Cache-Control", "public, max-age=86400");
    return res.json({ available: true, status: "MOCK_NO_KEY", panoId: null, date: null });
  }
  try {
    const meta = await fetchStreetViewMetadata(lat, lng);
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.json({
      available: meta.status === "OK",
      status: meta.status,
      panoId: meta.panoId,
      date: meta.date,
    });
  } catch (err) {
    // Upstream Street View metadata is wedged — degrade to mock instead of
    // hiding the gallery, so the report stays usable.
    console.warn(`[maps/streetview/meta] failed (${err.message}); reporting MOCK_FALLBACK`);
    res.setHeader("Cache-Control", "public, max-age=300");
    res.json({ available: true, status: "MOCK_FALLBACK", panoId: null, date: null });
  }
});

// ── GET /api/cities ──────────────────────────────────────────────────────────
router.get("/cities", (req, res) => {
  const cities = Object.entries(DISTRICTS).map(([id, d]) => ({
    id,
    name: d.name,
    center: d.center,
    districts: d.districts,
  }));
  res.json({ cities });
});

// ── POST /api/scans/preview ──────────────────────────────────────────────────
// Lightweight pre-flight peek for the scanner UI: take a drawn area and return
// a quick estimate of candidate count, transit/retail/hospital proximity at the
// area centroid, and a use-purpose breakdown so the operator can decide whether
// to hit "Start Scan" or redraw.
//
// Costs roughly: 1 PDOK Locatieserver call (free) + 1 Places call (cheap).
// Skipped if neither city nor area is provided.
router.post("/scans/preview", async (req, res) => {
  try {
    const { city, area = null, district = null } = req.body || {};
    if (!city) return res.status(400).json({ error: "city is required" });
    if (!DISTRICTS[city]) return res.status(400).json({ error: "Unknown city" });
    if (!area && !district) {
      return res.status(400).json({ error: "Either area or district is required" });
    }

    const cityCenter = DISTRICTS[city].center;

    // Pull a small sample (8 candidates is plenty for a preview).
    let sample = [];
    try {
      sample = await findSitesInArea({
        scanId: `preview_${Date.now()}`,
        city,
        district,
        cityCenter,
        area,
        count: 8,
      });
    } catch (err) {
      console.warn("[preview] PDOK failed:", err.message);
    }

    // Estimate full scan size: PDOK doesn't return density directly, but if a
    // small sample comes back full we can confidently say "~24 candidates".
    const estimatedCount =
      sample.length === 0
        ? 0
        : sample.length >= 8
          ? 24
          : Math.round(sample.length * 3);

    // Compute centroid for the Places lookup.
    let centroid = cityCenter; // [lat, lng]
    if (area?.type === "circle" && area?.center) {
      const c = area.center;
      centroid = [c[1] ?? c.lat, c[0] ?? c.lng];
    } else if (area?.geometry?.type === "Polygon") {
      const ring = area.geometry.coordinates[0];
      if (ring && ring.length) {
        let sumLat = 0;
        let sumLng = 0;
        for (const [lng, lat] of ring) {
          sumLat += lat;
          sumLng += lng;
        }
        centroid = [sumLat / ring.length, sumLng / ring.length];
      }
    }

    // Places lookup at centroid — fall back to mock so the preview always works.
    let context;
    try {
      context = await fetchNearbyPOIs(centroid[0], centroid[1], { radius: 500 });
    } catch (err) {
      if (process.env.NODE_ENV !== "test") {
        console.warn("[preview] Places fallback for centroid:", err.message);
      }
      context = generateNearbyPOIs(centroid[0], centroid[1]);
    }

    // Use-purpose breakdown from the sample so the operator sees what kind of
    // buildings are in the area.
    const purposeCounts = {};
    let vacancyProneCount = 0;
    const VACANCY_PRONE = new Set([
      "kantoorfunctie",
      "industriefunctie",
      "celfunctie",
      "overige gebruiksfunctie",
    ]);
    for (const s of sample) {
      const p = s.usePurpose || "unknown";
      purposeCounts[p] = (purposeCounts[p] || 0) + 1;
      if (VACANCY_PRONE.has(p)) vacancyProneCount++;
    }
    const purposes = Object.entries(purposeCounts)
      .map(([purpose, count]) => ({ purpose, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    // Quality verdict — gives the operator a one-line read.
    const verdict =
      estimatedCount === 0
        ? "no_candidates"
        : sample.length >= 6 && (vacancyProneCount / Math.max(1, sample.length)) >= 0.4
          ? "promising"
          : sample.length >= 4
            ? "moderate"
            : "thin";

    res.json({
      estimatedCount,
      sampleSize: sample.length,
      vacancyProneCount,
      verdict,
      centroid: { lat: centroid[0], lng: centroid[1] },
      context: {
        totalCount: context.totalCount,
        transitProximity: !!context.transitProximity,
        retailProximity: !!context.retailProximity,
        hospitalProximity: !!context.hospitalProximity,
        categories: context.categories || [],
      },
      purposes,
    });
  } catch (err) {
    console.error("POST /scans/preview failed:", err);
    res.status(500).json({ error: "Preview failed", detail: String(err.message || err) });
  }
});

// ── POST /api/scans ──────────────────────────────────────────────────────────
// Accepts either:
//   { city, district }                              — named district preset
//   { city, area: { type, geometry, center?, radiusM?, areaKm2?, vertexCount? } }
router.post("/scans", async (req, res) => {
  try {
    const store = getStore();
    const { city, district = null, area = null } = req.body || {};
    if (!city) return res.status(400).json({ error: "city is required" });
    if (!DISTRICTS[city]) return res.status(400).json({ error: "Unknown city" });
    if (!district && !area) {
      return res.status(400).json({ error: "Either district or area is required" });
    }

    const scanId = uuidv4().slice(0, 8);
    const areaLabel = district
      ? null
      : area?.type === "circle"
        ? `Radius ${area.radiusM}m`
        : `Polygon (${(area?.areaKm2 ?? 0).toFixed(2)} km²)`;

    const scan = {
      id: scanId,
      city,
      district,
      area: area || null,
      areaLabel,
      status: "running",
      siteCount: 0,
      createdAt: new Date().toISOString(),
    };
    await store.scans.create(scan);

    // Prefer real PDOK BAG addresses; fall back to the seeded mock generator
    // if PDOK is unreachable (dev offline, network hiccup, etc.).
    let sites;
    let siteSource = "pdok";
    try {
      sites = await findSitesInArea({
        scanId,
        city,
        district,
        cityCenter: DISTRICTS[city].center,
        area,
        count: 24,
      });
      if (sites.length < 6) {
        console.warn(
          `[scans] PDOK returned only ${sites.length} candidates; padding with mock`
        );
        const filler = generateSitesForScan(scanId, city, district, 24 - sites.length, area);
        // Re-key filler ids so we don't collide with PDOK sites.
        sites = sites.concat(
          filler.map((s, i) => ({
            ...s,
            id: `site_${scanId}_${sites.length + i}`,
            source: "mock",
          }))
        );
        siteSource = "pdok+mock";
      }
    } catch (err) {
      console.warn(
        "[scans] PDOK findSitesInArea failed; using mock generator:",
        err.message
      );
      sites = generateSitesForScan(scanId, city, district, 24, area).map((s) => ({
        ...s,
        source: "mock",
      }));
      siteSource = "mock";
    }

    await store.sites.bulkCreate(sites);

    const updated = await store.scans.update(scanId, {
      status: "complete",
      siteCount: sites.length,
      siteSource,
    });

    res.json({ scan: updated || scan, sites, meta: { siteSource } });
  } catch (err) {
    console.error("POST /scans failed:", err);
    res.status(500).json({ error: "Failed to create scan", detail: String(err.message || err) });
  }
});

// ── GET /api/scans ────────────────────────────────────────────────────────────
router.get("/scans", async (req, res) => {
  const store = getStore();
  const scans = await store.scans.list();
  res.json({ scans });
});

// ── GET /api/sites ────────────────────────────────────────────────────────────
router.get("/sites", async (req, res) => {
  const store = getStore();
  const { scanId } = req.query;

  const sites = scanId
    ? await store.sites.listByScan(scanId)
    : await store.sites.listAll();

  const hydrated = await Promise.all(
    sites.map(async (s) => {
      const [score, owner, conversion] = await Promise.all([
        store.scores.get(s.id),
        store.owners.get(s.id),
        store.conversions.get(s.id),
      ]);
      return {
        ...s,
        score: score || null,
        hasOwner: !!owner,
        hasConversion: !!conversion,
      };
    }),
  );

  hydrated.sort((a, b) => {
    const va = a.score?.vacancyScore ?? -1;
    const vb = b.score?.vacancyScore ?? -1;
    return vb - va;
  });

  res.json({ sites: hydrated });
});

// ── GET /api/sites/:id ────────────────────────────────────────────────────────
router.get("/sites/:id", async (req, res) => {
  const store = getStore();
  const site = await store.sites.get(req.params.id);
  if (!site) return res.status(404).json({ error: "Site not found" });

  const [score, owner, conversion, outreach] = await Promise.all([
    store.scores.get(site.id),
    store.owners.get(site.id),
    store.conversions.get(site.id),
    store.outreach.get(site.id),
  ]);

  res.json({ site, score, owner, conversion, outreach });
});

// ── POST /api/sites/:id/enrich ────────────────────────────────────────────────
router.post("/sites/:id/enrich", async (req, res) => {
  const store = getStore();
  const site = await store.sites.get(req.params.id);
  if (!site) return res.status(404).json({ error: "Site not found" });

  const context = await getContext(site);
  const streetViewUrl = generateStreetViewUrl(site.lat, site.lng);
  const mapImageUrl = generateMapImageUrl(site.lat, site.lng);

  // Free metadata check so the UI can skip rendering Street View where no
  // imagery exists (avoids "no imagery" placeholders + future wasted calls).
  let streetViewAvailable = null;
  try {
    const meta = await fetchStreetViewMetadata(site.lat, site.lng);
    streetViewAvailable = meta.status === "OK";
  } catch (err) {
    if (process.env.NODE_ENV !== "test") {
      console.warn(`[streetview] metadata failed for ${site.id}:`, err.message);
    }
  }

  const updated = await store.sites.update(site.id, {
    streetViewUrl,
    mapImageUrl,
    streetViewAvailable,
    context,
    enrichedAt: new Date().toISOString(),
    status: "enriched",
  });

  res.json({ site: updated, context });
});

// ── POST /api/sites/:id/score ─────────────────────────────────────────────────
router.post("/sites/:id/score", async (req, res) => {
  const store = getStore();
  const site = await store.sites.get(req.params.id);
  if (!site) return res.status(404).json({ error: "Site not found" });

  const context = await getContext(site);
  const frontage = await analyzeFrontage(site.lat, site.lng);
  const scoreResult = scoresite(site, context, { frontage });
  await store.scores.set(site.id, scoreResult);
  await store.sites.update(site.id, {
    context,
    frontage,
    status: "scored",
  });

  res.json({ score: scoreResult, context, frontage });
});

// ── POST /api/scans/:scanId/score-all ─────────────────────────────────────────
router.post("/scans/:scanId/score-all", async (req, res) => {
  const store = getStore();
  const sites = await store.sites.listByScan(req.params.scanId);
  if (!sites.length) return res.status(404).json({ error: "No sites for scan" });

  // Run in bounded parallel to keep Places QPS sensible but finish fast.
  const CONCURRENCY = 4;
  let cursor = 0;
  let placesCalls = 0;
  let placesFailures = 0;
  async function worker() {
    while (cursor < sites.length) {
      const site = sites[cursor++];
      let context;
      try {
        context = await fetchNearbyPOIs(site.lat, site.lng);
        placesCalls++;
      } catch (err) {
        placesFailures++;
        if (process.env.NODE_ENV !== "test") {
          console.warn(`[places] score-all fallback for ${site.id}:`, err.message);
        }
        context = generateNearbyPOIs(site.lat, site.lng);
      }
      const frontage = await analyzeFrontage(site.lat, site.lng);
      const scoreResult = scoresite(site, context, { frontage });
      await store.scores.set(site.id, scoreResult);
      await store.sites.update(site.id, {
        context,
        frontage,
        status: "scored",
      });
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  const outreach = await queueEligibleSitesForScan(req.params.scanId, store);
  await processOutreachQueueOnce(store);

  res.json({
    scored: sites.length,
    placesCalls,
    placesFailures,
    outreachQueued: outreach.queued,
    outreachSiteIds: outreach.siteIds,
  });
});

// ── POST /api/sites/:id/ownership ─────────────────────────────────────────────
router.post("/sites/:id/ownership", async (req, res) => {
  const store = getStore();
  const site = await store.sites.get(req.params.id);
  if (!site) return res.status(404).json({ error: "Site not found" });

  await new Promise((r) => setTimeout(r, 800));

  const ownership = generateOwnership(site);
  await store.owners.set(site.id, ownership);
  await store.sites.update(site.id, { status: "owner_found" });

  const score = await store.scores.get(site.id);
  if (score) {
    const conversion = computeConversionModel(site, score);
    await store.conversions.set(site.id, conversion);
  }

  res.json({ ownership });
});

// ── GET /api/owners/portfolio ────────────────────────────────────────────────
// Returns every site that's been linked to a given owner name across all scans.
// Powers the "this owner appears on N other sites" card on the report page.
router.get("/owners/portfolio", async (req, res) => {
  const store = getStore();
  const name = typeof req.query.name === "string" ? req.query.name.trim() : "";
  if (!name) return res.status(400).json({ error: "name query parameter is required" });

  const matches = await store.owners.listByName(name);
  if (matches.length === 0) {
    return res.json({ ownerName: name, sites: [] });
  }

  const hydrated = await Promise.all(
    matches.map(async (m) => {
      const site = await store.sites.get(m.siteId);
      if (!site) return null;
      const score = await store.scores.get(m.siteId);
      return {
        siteId: m.siteId,
        scanId: site.scanId,
        address: site.address,
        street: site.street,
        houseNumber: site.houseNumber,
        postcode: site.postcode,
        city: site.city,
        district: site.district,
        lat: site.lat,
        lng: site.lng,
        usePurpose: site.usePurpose,
        areaSqm: site.areaSqm,
        bagStatus: site.bagStatus,
        siteStatus: site.status,
        score: score || null,
        parcelRef: m.parcelRef,
        ownershipType: m.ownershipType,
      };
    }),
  );

  const sites = hydrated.filter(Boolean).sort((a, b) => {
    const va = a.score?.vacancyScore ?? -1;
    const vb = b.score?.vacancyScore ?? -1;
    return vb - va;
  });

  res.json({ ownerName: name, sites, totalCount: sites.length });
});

// ── GET /api/sites/:id/report ──────────────────────────────────────────────────
router.get("/sites/:id/report", async (req, res) => {
  const store = getStore();
  const site = await store.sites.get(req.params.id);
  if (!site) return res.status(404).json({ error: "Site not found" });

  const [score, owner, storedConversion] = await Promise.all([
    store.scores.get(site.id),
    store.owners.get(site.id),
    store.conversions.get(site.id),
  ]);

  if (!score || !owner) {
    return res.status(400).json({ error: "Site requires score and ownership lookup before report" });
  }

  const conversion = storedConversion?.modelVersion === "2.0.0"
    ? storedConversion
    : await store.conversions.set(site.id, computeConversionModel(site, score));
  const outreach = await ensureOutreachDraft(site.id, store);
  await store.sites.update(site.id, { status: "report_ready" });

  const report = {
    siteId: site.id,
    generatedAt: new Date().toISOString(),
    site,
    score,
    owner,
    conversion,
    outreach,
    pdfUrl: `/api/sites/${site.id}/report.pdf`,
  };

  res.json({ report });
});

// ── GET /api/sites/:id/report.pdf ─────────────────────────────────────────────
router.get("/sites/:id/report.pdf", async (req, res) => {
  const store = getStore();
  const site = await store.sites.get(req.params.id);
  if (!site) return res.status(404).json({ error: "Site not found" });

  const [score, owner, conversion] = await Promise.all([
    store.scores.get(site.id),
    store.owners.get(site.id),
    store.conversions.get(site.id),
  ]);
  if (!score || !owner) {
    return res
      .status(400)
      .json({ error: "Site requires score and ownership lookup before report" });
  }

  // Make sure an outreach draft + report_ready status exist so the print page
  // renders with full content when hit directly.
  await ensureOutreachDraft(site.id, store);
  await store.sites.update(site.id, { status: "report_ready" });

  try {
    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
    const pdf = await renderReportPdf(site.id, { frontendUrl });
    const download = req.query.download === "1";
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Length", pdf.length);
    res.setHeader(
      "Content-Disposition",
      `${download ? "attachment" : "inline"}; filename="parkscan-${site.id}.pdf"`,
    );
    res.end(pdf);
  } catch (err) {
    console.error("PDF render failed:", err);
    res
      .status(500)
      .json({ error: "Failed to render PDF", detail: String(err?.message || err) });
  }
});

// ── PATCH /api/sites/:id/outreach ─────────────────────────────────────────────
router.patch("/sites/:id/outreach", async (req, res) => {
  const store = getStore();
  const { status, draft, subject } = req.body;
  const existing = await store.outreach.get(req.params.id);
  const patch = {};
  if (status !== undefined) {
    if (!MANUAL_OUTREACH_STATUSES.has(status)) {
      return res.status(400).json({ error: "Unsupported manual outreach status" });
    }
    if (status === "queued" && existing?.status === "sent") {
      return res.status(400).json({ error: "Sent outreach cannot be re-queued" });
    }
    patch.status = status;
  }
  if (draft !== undefined) patch.draft = draft;
  if (subject !== undefined) patch.subject = subject;

  const updated = await store.outreach.upsert(req.params.id, patch);

  if (status === "queued") {
    await processOutreachQueueOnce(store);
  }

  res.json({ outreach: updated });
});

// ── GET /api/outreach ────────────────────────────────────────────────────────
router.get("/outreach", async (req, res) => {
  const store = getStore();
  const scanId = typeof req.query.scanId === "string" ? req.query.scanId : null;
  const status = typeof req.query.status === "string" && req.query.status !== "all"
    ? req.query.status
    : null;
  const items = await hydrateOutreachItems(await store.outreach.list({ status: null }), store, {
    scanId,
    status,
  });
  res.json({
    items,
    meta: {
      policy: getOutreachPolicyMeta(),
    },
  });
});

// ── POST /api/scans/:scanId/outreach ────────────────────────────────────────
router.post("/scans/:scanId/outreach", async (req, res) => {
  const store = getStore();
  const scan = await store.scans.get(req.params.scanId);
  if (!scan) return res.status(404).json({ error: "Scan not found" });

  const queued = await queueEligibleSitesForScan(req.params.scanId, store);
  await processOutreachQueueOnce(store);

  res.json(queued);
});

// ── POST /api/outreach/:siteId/approve-send ─────────────────────────────────
router.post("/outreach/:siteId/approve-send", async (req, res) => {
  const store = getStore();
  try {
    const outreach = await approveAndSendOutreach(req.params.siteId, store);
    res.json({ outreach });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ── POST /api/outreach/:siteId/skip ─────────────────────────────────────────
router.post("/outreach/:siteId/skip", async (req, res) => {
  const store = getStore();
  try {
    const outreach = await skipOutreach(req.params.siteId, store);
    res.json({ outreach });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ── POST /api/outreach/:siteId/retry ────────────────────────────────────────
router.post("/outreach/:siteId/retry", async (req, res) => {
  const store = getStore();
  try {
    const outreach = await retryOutreach(req.params.siteId, store);
    res.json({ outreach });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ── POST /api/outreach/:siteId/simulate-reply ───────────────────────────────
// Demo aid for "what happens after we send": flip a sent item into a reply
// state without standing up a real inbox. Phase 2 plugs in IMAP/webhooks here.
router.post("/outreach/:siteId/simulate-reply", async (req, res) => {
  const store = getStore();
  const outcome = (req.body && req.body.outcome) || "";
  try {
    const outreach = await simulateReply(req.params.siteId, outcome, store);
    res.json({ outreach });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ── GET /api/stats ─────────────────────────────────────────────────────────────
router.get("/stats", async (req, res) => {
  const store = getStore();
  const [sites, ownerCount, outreach] = await Promise.all([
    store.sites.listAll(),
    store.owners.count(),
    store.outreach.list(),
  ]);
  const scoredSites = (await Promise.all(
    sites.map(async (site) => {
      const score = await store.scores.get(site.id);
      if (!score) return null;
      return {
        site,
        score,
        conversion: computeConversionModel(site, score),
      };
    }),
  )).filter(Boolean);

  const conversionTotals = scoredSites.reduce(
    (acc, item) => {
      acc.totalParkingSpaces += item.conversion.spacesEst || 0;
      acc.monthlyRevenue += item.conversion.revenueBase || 0;
      acc.monthlyNetRevenue += item.conversion.netRevenueMonthly || 0;
      acc.annualNetRevenue += item.conversion.annualNetRevenue || 0;
      acc.setupCost += item.conversion.setupCostBase || 0;
      acc.roiPctSum += item.conversion.annualRoiPct || 0;
      if (item.conversion.roiMonths) acc.paybackMonths.push(item.conversion.roiMonths);
      return acc;
    },
    {
      totalParkingSpaces: 0,
      monthlyRevenue: 0,
      monthlyNetRevenue: 0,
      annualNetRevenue: 0,
      setupCost: 0,
      roiPctSum: 0,
      paybackMonths: [],
    },
  );
  const avgRoiPct = scoredSites.length
    ? Math.round(conversionTotals.roiPctSum / scoredSites.length)
    : 0;
  const avgPaybackMonths = conversionTotals.paybackMonths.length
    ? Math.round(
        conversionTotals.paybackMonths.reduce((sum, months) => sum + months, 0) /
          conversionTotals.paybackMonths.length,
      )
    : null;
  const topConversionCandidates = [...scoredSites]
    .sort((a, b) => {
      const bValue = (b.conversion.annualNetRevenue || 0) * ((b.score.parkingScore || 0) / 100);
      const aValue = (a.conversion.annualNetRevenue || 0) * ((a.score.parkingScore || 0) / 100);
      return bValue - aValue;
    })
    .slice(0, 5)
    .map(({ site, score, conversion }) => ({
      siteId: site.id,
      address: site.address,
      street: site.street,
      houseNumber: site.houseNumber,
      postcode: site.postcode,
      usePurpose: site.usePurpose,
      areaSqm: site.areaSqm,
      vacancyScore: score.vacancyScore,
      parkingScore: score.parkingScore,
      spacesEst: conversion.spacesEst,
      revenueBase: conversion.revenueBase,
      annualNetRevenue: conversion.annualNetRevenue,
      roiMonths: conversion.roiMonths,
      annualRoiPct: conversion.annualRoiPct,
    }));

  res.json({
    totalSites: sites.length,
    totalScanned: scoredSites.length,
    highVacancy: scoredSites.filter(({ score }) => score.vacancyScore >= 65).length,
    ownersFound: ownerCount,
    reportsReady: sites.filter((s) => s.status === "report_ready").length,
    contacted: sites.filter((s) => s.status === "contacted").length,
    negotiating: sites.filter((s) => s.status === "negotiating").length,
    totalParkingSpaces: conversionTotals.totalParkingSpaces,
    monthlyRevenue: conversionTotals.monthlyRevenue,
    monthlyNetRevenue: conversionTotals.monthlyNetRevenue,
    annualNetRevenue: conversionTotals.annualNetRevenue,
    setupCost: conversionTotals.setupCost,
    avgRoiPct,
    avgPaybackMonths,
    topConversionCandidates,
    queued: outreach.filter((item) => OUTREACH_ACTIVE_STATUSES.has(item.status)).length,
    awaitingApproval: outreach.filter((item) => item.status === "awaiting_approval").length,
    failed: outreach.filter((item) => item.status === "failed").length,
    sent: outreach.filter((item) => item.status === "sent").length,
    repliedInterested: outreach.filter((item) => item.status === "replied_interested").length,
    repliedNotInterested: outreach.filter((item) => item.status === "replied_not_interested").length,
    noReply: outreach.filter((item) => item.status === "no_reply").length,
    awaitingReply: outreach.filter(
      (item) => item.status === "sent" && !OUTREACH_REPLY_STATUSES.has(item.status),
    ).length,
  });
});

export default router;
