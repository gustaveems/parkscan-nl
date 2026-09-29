// Helpers for building backend image-proxy URLs. The proxy keeps the Google
// API key server-side.


// ── GitHub Pages demo: <img> tags can't go through the fetch shim, so map /
// Street View URLs become labelled inline SVG placeholders (same idea as the
// backend's zero-key mock SVGs).
const DEMO_MODE =
  typeof location !== "undefined" &&
  (location.hostname.endsWith("github.io") ||
    new URLSearchParams(location.search).get("demo") === "1");

function demoSvg(title, sub) {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400">` +
    `<rect width="100%" height="100%" fill="#121c30"/>` +
    `<rect x="8" y="8" width="624" height="384" fill="none" stroke="#3b82f6" stroke-dasharray="6 6"/>` +
    `<text x="50%" y="47%" fill="#60a5fa" font-family="Arial" font-size="22" text-anchor="middle">${title}</text>` +
    `<text x="50%" y="57%" fill="#64748b" font-family="monospace" font-size="13" text-anchor="middle">${sub}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

const DEFAULTS = {
  staticSize: "640x400",
  staticZoom: 17,
  streetviewSize: "640x400",
  streetviewHeading: 0,
  streetviewPitch: 10,
  streetviewFov: 80,
};

export function mapStaticUrl(lat, lng, opts = {}) {
  if (DEMO_MODE) return demoSvg("Static Map · live in full app", `${lat.toFixed(5)}, ${lng.toFixed(5)}`);
  const params = new URLSearchParams({
    lat: String(lat),
    lng: String(lng),
    size: opts.size || DEFAULTS.staticSize,
    zoom: String(opts.zoom ?? DEFAULTS.staticZoom),
  });
  if (opts.maptype) params.set("maptype", opts.maptype);
  return `/api/maps/static?${params.toString()}`;
}

export function streetViewUrl(lat, lng, opts = {}) {
  if (DEMO_MODE) return demoSvg("Street View · live in full app", `heading ${opts.heading ?? 0}° · ${lat.toFixed(4)},${lng.toFixed(4)}`);
  const params = new URLSearchParams({
    lat: String(lat),
    lng: String(lng),
    size: opts.size || DEFAULTS.streetviewSize,
    heading: String(opts.heading ?? DEFAULTS.streetviewHeading),
    pitch: String(opts.pitch ?? DEFAULTS.streetviewPitch),
    fov: String(opts.fov ?? DEFAULTS.streetviewFov),
  });
  return `/api/maps/streetview?${params.toString()}`;
}

export async function streetViewAvailable(lat, lng) {
  try {
    const res = await fetch(
      `/api/maps/streetview/meta?lat=${lat}&lng=${lng}`
    );
    if (!res.ok) return false;
    const json = await res.json();
    return Boolean(json.available);
  } catch {
    return false;
  }
}

// Four cardinal Street View angles around a location so the user gets a proper
// 360° survey instead of a single frontage shot. Labels match what a viewer
// would expect on a map (North is up).
export const CARDINAL_HEADINGS = [
  { heading: 0,   label: "North", short: "N" },
  { heading: 90,  label: "East",  short: "E" },
  { heading: 180, label: "South", short: "S" },
  { heading: 270, label: "West",  short: "W" },
];

export function streetViewUrls360(lat, lng, opts = {}) {
  const size = opts.size || DEFAULTS.streetviewSize;
  const pitch = opts.pitch ?? DEFAULTS.streetviewPitch;
  const fov = opts.fov ?? DEFAULTS.streetviewFov;
  return CARDINAL_HEADINGS.map((c) => ({
    ...c,
    url: streetViewUrl(lat, lng, { size, heading: c.heading, pitch, fov }),
  }));
}
