// Helpers for building backend image-proxy URLs. The proxy keeps the Google
// API key server-side.

const DEFAULTS = {
  staticSize: "640x400",
  staticZoom: 17,
  streetviewSize: "640x400",
  streetviewHeading: 0,
  streetviewPitch: 10,
  streetviewFov: 80,
};

export function mapStaticUrl(lat, lng, opts = {}) {
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
