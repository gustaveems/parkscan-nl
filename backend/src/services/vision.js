// Google Cloud Vision wrapper — frontage analysis on Street View imagery.
//
// Today: mock signals derived deterministically from coordinates so scoring
// is reproducible. Tomorrow: same interface, real Vision annotations when
// GOOGLE_APPLICATION_CREDENTIALS (service account) or GOOGLE_VISION_API_KEY
// is present.
//
// The scoring engine consumes { inactiveFrontage, signals } from the aggregated
// result. The per-heading detail (`headings`) powers the SitePage annotated
// gallery so the operator can see *which* angles look vacant.

const CARDINAL_HEADINGS = [
  { heading: 0,   label: "North", short: "N" },
  { heading: 90,  label: "East",  short: "E" },
  { heading: 180, label: "South", short: "S" },
  { heading: 270, label: "West",  short: "W" },
];

// Label classification — keep the lists tight so a real Cloud Vision response
// has plenty of "neutral" detections (sky, road, building) and only meaningful
// signals get coloured in the UI.
const VACANCY_POSITIVE_LABELS = new Set([
  "shutter", "shutters", "boarded up", "boarded", "metal shutter",
  "roller shutter", "grille", "graffiti", "tag", "vegetation",
  "abandoned", "construction", "scaffolding", "dilapidated", "vacant",
  "rust", "decay", "rubble", "wreckage", "ruin", "weathering",
]);

const VACANCY_NEGATIVE_LABELS = new Set([
  "signage", "sign", "advertising", "banner", "storefront", "shopfront",
  "customer", "pedestrian", "person", "people", "business",
  "shop", "retail", "restaurant", "cafe", "bicycle", "vehicle", "car",
  "lighting", "lit window", "neon", "logo",
]);

export function visionProvider() {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) return "vision_sa";
  if (process.env.GOOGLE_VISION_API_KEY) return "vision_api_key";
  return "mock";
}

export function visionEnabled() {
  return visionProvider() !== "mock";
}

function hashSeed(lat, lng, salt = "") {
  const s = `${Math.round(lat * 1e5)}|${Math.round(lng * 1e5)}|${salt}`;
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function rng(seed) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0xffffffff;
  };
}

function classifyLabel(name) {
  const n = (name || "").toLowerCase();
  if (VACANCY_POSITIVE_LABELS.has(n)) return "vacancy_positive";
  if (VACANCY_NEGATIVE_LABELS.has(n)) return "vacancy_negative";
  // soft contains-match for compound labels coming back from Vision
  for (const term of VACANCY_POSITIVE_LABELS) {
    if (n.includes(term)) return "vacancy_positive";
  }
  for (const term of VACANCY_NEGATIVE_LABELS) {
    if (n.includes(term)) return "vacancy_negative";
  }
  return "neutral";
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Analyze frontage at (lat, lng) across all four cardinal headings and return
 * an aggregated result the scoring engine consumes (`inactiveFrontage`,
 * `signals`) plus a `headings` array the UI can render annotation chips from.
 *
 * @returns {Promise<{
 *   inactiveFrontage: boolean,
 *   signals: string[],
 *   provider: string,
 *   confidence: number,
 *   headings: Array<{
 *     heading: number, label: string, short: string,
 *     inactive: boolean, signals: string[],
 *     labels: Array<{ description: string, classification: string, score: number }>,
 *     provider: string, confidence: number,
 *     error?: string,
 *   }>,
 * }>}
 */
export async function analyzeFrontage(lat, lng) {
  const provider = visionProvider();
  const headings = await Promise.all(
    CARDINAL_HEADINGS.map((c) =>
      analyzeOneHeading(lat, lng, c, provider).catch((err) => ({
        ...c,
        inactive: false,
        signals: [],
        labels: [],
        provider: "mock",
        confidence: 0,
        error: err.message,
      })),
    ),
  );
  return aggregate(headings, provider);
}

async function analyzeOneHeading(lat, lng, cardinal, provider) {
  if (provider === "mock") return mockHeading(lat, lng, cardinal);
  try {
    if (provider === "vision_sa") return await visionSaHeading(lat, lng, cardinal);
    if (provider === "vision_api_key") return await visionApiKeyHeading(lat, lng, cardinal);
  } catch (err) {
    console.warn(
      `[vision] ${provider} failed for heading ${cardinal.heading}; fallback to mock:`,
      err.message,
    );
    return mockHeading(lat, lng, cardinal);
  }
  return mockHeading(lat, lng, cardinal);
}

// Aggregate per-heading outcomes into the shape `scoringEngine.js` expects.
function aggregate(headings, provider) {
  const inactiveCount = headings.filter((h) => h.inactive).length;
  const inactiveFrontage = inactiveCount >= 2;
  // Surface the strongest signals from the inactive headings.
  const signals = [];
  for (const h of headings) {
    if (!h.inactive) continue;
    for (const s of h.signals) {
      if (!signals.includes(s)) signals.push(s);
      if (signals.length >= 3) break;
    }
    if (signals.length >= 3) break;
  }
  if (signals.length === 0) {
    // even if not flagged as inactive, surface one neutral signal so the score
    // signal panel has something useful to display.
    for (const h of headings) {
      if (h.signals.length) {
        signals.push(h.signals[0]);
        break;
      }
    }
  }
  const avgConfidence =
    headings.reduce((acc, h) => acc + (h.confidence || 0), 0) /
    Math.max(1, headings.length);
  return {
    inactiveFrontage,
    signals,
    provider,
    confidence: Number(avgConfidence.toFixed(3)),
    headings,
  };
}

// ── Mock per-heading analysis ──────────────────────────────────────────────
function mockHeading(lat, lng, cardinal) {
  const r = rng(hashSeed(lat, lng, String(cardinal.heading)));
  const p = r();
  const inactive = p < 0.4;

  // Build a plausible label list. Real Vision returns ~10-15 labels per image,
  // mostly neutral; we mirror that distribution so the gallery doesn't look
  // empty when the API key is missing.
  const NEUTRAL_LABELS = ["building", "window", "facade", "sky", "road", "street"];
  const POSITIVE_POOL = [
    "shuttered storefront", "no visible signage", "boarded window",
    "metal shutter", "graffiti", "abandoned",
  ];
  const NEGATIVE_POOL = [
    "active signage", "lit interior", "pedestrian flow",
    "shop", "logo", "advertising",
  ];

  const labels = [];
  // Always include 2-3 neutral labels.
  const neutralN = 2 + Math.floor(r() * 2);
  for (let i = 0; i < neutralN; i++) {
    const name = NEUTRAL_LABELS[Math.floor(r() * NEUTRAL_LABELS.length)];
    if (!labels.find((l) => l.description === name)) {
      labels.push({ description: name, classification: "neutral", score: 0.6 + r() * 0.35 });
    }
  }
  if (inactive) {
    const n = 1 + Math.floor(r() * 2);
    for (let i = 0; i < n; i++) {
      const name = POSITIVE_POOL[Math.floor(r() * POSITIVE_POOL.length)];
      if (!labels.find((l) => l.description === name)) {
        labels.push({
          description: name,
          classification: "vacancy_positive",
          score: 0.55 + r() * 0.4,
        });
      }
    }
  } else {
    const n = 1 + Math.floor(r() * 2);
    for (let i = 0; i < n; i++) {
      const name = NEGATIVE_POOL[Math.floor(r() * NEGATIVE_POOL.length)];
      if (!labels.find((l) => l.description === name)) {
        labels.push({
          description: name,
          classification: "vacancy_negative",
          score: 0.55 + r() * 0.4,
        });
      }
    }
  }

  const positiveLabels = labels.filter((l) => l.classification === "vacancy_positive");
  const negativeLabels = labels.filter((l) => l.classification === "vacancy_negative");
  const signals = positiveLabels.length
    ? positiveLabels.map((l) => capitalise(l.description))
    : negativeLabels.length
      ? negativeLabels.map((l) => capitalise(l.description))
      : [];

  return {
    ...cardinal,
    inactive,
    signals,
    labels,
    provider: "mock",
    confidence: 0.55 + r() * 0.3,
  };
}

function capitalise(s) {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ── Real Vision per-heading helpers ────────────────────────────────────────
async function fetchStreetViewImageBytes(lat, lng, heading = 0) {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) throw new Error("GOOGLE_MAPS_API_KEY not configured");
  const url = new URL("https://maps.googleapis.com/maps/api/streetview");
  url.searchParams.set("size", "640x400");
  url.searchParams.set("location", `${lat},${lng}`);
  url.searchParams.set("heading", String(heading));
  url.searchParams.set("pitch", "10");
  url.searchParams.set("fov", "80");
  url.searchParams.set("key", key);
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`Street View ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

function buildLabelList(rawLabels = [], maxN = 8) {
  return rawLabels
    .slice(0, maxN)
    .map((l) => ({
      description: l.description || "",
      classification: classifyLabel(l.description),
      score: typeof l.score === "number" ? Number(l.score.toFixed(3)) : 0,
    }));
}

function summariseHeading(cardinal, labels, hasText, hasPedestrian, provider, rawCount) {
  const positive = labels.filter((l) => l.classification === "vacancy_positive");
  const negative = labels.filter((l) => l.classification === "vacancy_negative");
  const hasShuttered = positive.some((l) => /shutter|boarded|grille/i.test(l.description));
  const hasSignage = negative.some((l) => /sign|advert|banner|logo/i.test(l.description)) || hasText;

  const inactive = hasShuttered || (!hasSignage && !hasPedestrian && positive.length >= 1);
  const signals = [];
  if (hasShuttered) signals.push("Shuttered/boarded facade detected");
  if (positive.length && !hasShuttered) {
    signals.push(`Vacancy cue: ${positive[0].description}`);
  }
  if (!hasSignage) signals.push("No visible signage");
  if (!hasPedestrian && inactive) signals.push("No pedestrian presence");
  if (hasSignage && !inactive) signals.push("Signage detected");
  if (hasPedestrian && !inactive) signals.push("Pedestrian activity");

  const confidence =
    0.55 +
    (hasShuttered ? 0.2 : 0) +
    (positive.length ? 0.05 : 0) +
    (rawCount > 5 ? 0.05 : 0);

  return {
    ...cardinal,
    inactive,
    signals: signals.slice(0, 3),
    labels,
    provider,
    confidence: Number(Math.min(0.99, confidence).toFixed(3)),
  };
}

let _visionClient = null;
async function visionClient() {
  if (_visionClient) return _visionClient;
  const vision = await import("@google-cloud/vision").catch(() => null);
  if (!vision) throw new Error("@google-cloud/vision not installed — run `npm i @google-cloud/vision`");
  _visionClient = new vision.ImageAnnotatorClient();
  return _visionClient;
}

async function visionSaHeading(lat, lng, cardinal) {
  const [client, bytes] = await Promise.all([
    visionClient(),
    fetchStreetViewImageBytes(lat, lng, cardinal.heading),
  ]);
  const [labelR, textR, objectR] = await Promise.all([
    client.labelDetection({ image: { content: bytes } }),
    client.textDetection({ image: { content: bytes } }),
    client.objectLocalization({ image: { content: bytes } }),
  ]);
  const rawLabels = labelR?.[0]?.labelAnnotations || [];
  const labels = buildLabelList(rawLabels);
  const text = textR?.[0]?.fullTextAnnotation?.text;
  const objects = objectR?.[0]?.localizedObjectAnnotations || [];
  const hasPedestrian = objects.some((o) => /person|pedestrian/i.test(o.name || ""));
  return summariseHeading(cardinal, labels, !!(text && text.length > 3), hasPedestrian, "vision_sa", rawLabels.length);
}

async function visionApiKeyHeading(lat, lng, cardinal) {
  const bytes = await fetchStreetViewImageBytes(lat, lng, cardinal.heading);
  const url = `https://vision.googleapis.com/v1/images:annotate?key=${process.env.GOOGLE_VISION_API_KEY}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      requests: [
        {
          image: { content: bytes.toString("base64") },
          features: [
            { type: "LABEL_DETECTION", maxResults: 15 },
            { type: "TEXT_DETECTION", maxResults: 5 },
            { type: "OBJECT_LOCALIZATION", maxResults: 10 },
          ],
        },
      ],
    }),
  });
  if (!res.ok) throw new Error(`Vision REST ${res.status}: ${await res.text()}`);
  const json = await res.json();
  const r = json.responses?.[0] || {};
  const rawLabels = r.labelAnnotations || [];
  const labels = buildLabelList(rawLabels);
  const text = r.fullTextAnnotation?.text;
  const objects = r.localizedObjectAnnotations || [];
  const hasPedestrian = objects.some((o) => /person|pedestrian/i.test(o.name || ""));
  return summariseHeading(
    cardinal,
    labels,
    !!(text && text.length > 3),
    hasPedestrian,
    "vision_api_key",
    rawLabels.length,
  );
}
