import { useEffect, useRef, useState, useCallback } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import './ScanMap.css';

// OpenStreetMap raster style (no API key required).
// Switch to a Google Maps JS source later by swapping this style object.
const MAP_STYLE = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '© OpenStreetMap contributors',
      maxzoom: 19,
    },
  },
  layers: [
    { id: 'osm', type: 'raster', source: 'osm' },
  ],
};

const ACCENT = '#3b82f6';
const ACCENT_LIGHT = '#60a5fa';

function metersPerPixel(lat, zoom) {
  return (156543.03392 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, zoom);
}

// Haversine distance in meters between two [lng, lat] points.
function haversine([lng1, lat1], [lng2, lat2]) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Build a GeoJSON polygon approximating a geodesic circle (64 vertices).
function circleToPolygon([lng, lat], radiusMeters, steps = 64) {
  const coords = [];
  const R = 6371000;
  const latRad = (lat * Math.PI) / 180;
  for (let i = 0; i <= steps; i++) {
    const bearing = (i / steps) * 2 * Math.PI;
    const dByR = radiusMeters / R;
    const newLat = Math.asin(
      Math.sin(latRad) * Math.cos(dByR) +
        Math.cos(latRad) * Math.sin(dByR) * Math.cos(bearing)
    );
    const newLng =
      ((lng * Math.PI) / 180) +
      Math.atan2(
        Math.sin(bearing) * Math.sin(dByR) * Math.cos(latRad),
        Math.cos(dByR) - Math.sin(latRad) * Math.sin(newLat)
      );
    coords.push([(newLng * 180) / Math.PI, (newLat * 180) / Math.PI]);
  }
  return { type: 'Polygon', coordinates: [coords] };
}

// Shoelace area for a ring of [lng, lat] coords, approximated in km².
function polygonAreaKm2(ring) {
  if (!ring || ring.length < 3) return 0;
  const R = 6371000;
  let total = 0;
  for (let i = 0; i < ring.length; i++) {
    const [lng1, lat1] = ring[i];
    const [lng2, lat2] = ring[(i + 1) % ring.length];
    total +=
      (((lng2 - lng1) * Math.PI) / 180) *
      (2 + Math.sin((lat1 * Math.PI) / 180) + Math.sin((lat2 * Math.PI) / 180));
  }
  const areaM2 = Math.abs((total * R * R) / 2);
  return areaM2 / 1_000_000;
}

const EMPTY_FC = { type: 'FeatureCollection', features: [] };

export default function ScanMap({
  mode,        // 'polygon' | 'radius'
  center,      // [lat, lng]
  zoom = 12,
  onChange,    // (geometry) => void, geometry is GeoJSON Polygon or null
  candidateSites = [], // optional: [{ id, lat, lng, score? }]
}) {
  const mapContainer = useRef(null);
  const mapRef = useRef(null);
  const [mapReady, setMapReady] = useState(false);

  // Drawing state (refs to avoid stale closures inside map listeners).
  const polygonPointsRef = useRef([]);
  const circleCenterRef = useRef(null);
  const radiusMRef = useRef(500);

  const [polygonPoints, setPolygonPoints] = useState([]);
  const [circleCenter, setCircleCenter] = useState(null);
  const [radiusM, setRadiusM] = useState(500);
  const [hoverPoint, setHoverPoint] = useState(null);

  // ── Init map ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!mapContainer.current || mapRef.current) return;
    const [lat, lng] = center;
    const map = new maplibregl.Map({
      container: mapContainer.current,
      style: MAP_STYLE,
      center: [lng, lat],
      zoom,
      attributionControl: { compact: true },
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    map.on('load', () => {
      map.addSource('draw', { type: 'geojson', data: EMPTY_FC });
      map.addSource('draw-vertices', { type: 'geojson', data: EMPTY_FC });
      map.addSource('candidates', { type: 'geojson', data: EMPTY_FC });

      map.addLayer({
        id: 'draw-fill',
        type: 'fill',
        source: 'draw',
        paint: { 'fill-color': ACCENT, 'fill-opacity': 0.15 },
      });
      map.addLayer({
        id: 'draw-line',
        type: 'line',
        source: 'draw',
        paint: { 'line-color': ACCENT_LIGHT, 'line-width': 2 },
      });
      map.addLayer({
        id: 'draw-vertex',
        type: 'circle',
        source: 'draw-vertices',
        paint: {
          'circle-radius': 5,
          'circle-color': '#fff',
          'circle-stroke-color': ACCENT,
          'circle-stroke-width': 2,
        },
      });
      map.addLayer({
        id: 'candidate-dots',
        type: 'circle',
        source: 'candidates',
        paint: {
          'circle-radius': 4,
          'circle-color': [
            'case',
            ['>=', ['coalesce', ['get', 'score'], 0], 65], '#10b981',
            ['>=', ['coalesce', ['get', 'score'], 0], 40], '#f59e0b',
            '#5a6a85',
          ],
          'circle-stroke-color': '#0e1117',
          'circle-stroke-width': 1,
        },
      });

      setMapReady(true);
    });

    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
    // We intentionally initialize only once; view changes are handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Recenter when the city changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const [lat, lng] = center;
    map.flyTo({ center: [lng, lat], zoom, speed: 1.2 });
  }, [center[0], center[1], zoom, mapReady]);

  // Keep refs in sync with state so map listeners read current values.
  useEffect(() => { polygonPointsRef.current = polygonPoints; }, [polygonPoints]);
  useEffect(() => { circleCenterRef.current = circleCenter; }, [circleCenter]);
  useEffect(() => { radiusMRef.current = radiusM; }, [radiusM]);

  // ── Render drawing to map layers ──────────────────────────────────────────
  const renderDraw = useCallback(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const drawSrc = map.getSource('draw');
    const vertSrc = map.getSource('draw-vertices');
    if (!drawSrc || !vertSrc) return;

    let fc = EMPTY_FC;
    let verts = EMPTY_FC;

    if (mode === 'polygon') {
      const pts = polygonPoints.slice();
      const preview = hoverPoint && pts.length > 0 ? [...pts, hoverPoint] : pts;
      if (preview.length >= 2) {
        const closed = preview.length >= 3 ? [...preview, preview[0]] : preview;
        fc = {
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              properties: {},
              geometry: { type: 'LineString', coordinates: closed },
            },
            ...(preview.length >= 3
              ? [
                  {
                    type: 'Feature',
                    properties: {},
                    geometry: {
                      type: 'Polygon',
                      coordinates: [[...preview, preview[0]]],
                    },
                  },
                ]
              : []),
          ],
        };
      }
      verts = {
        type: 'FeatureCollection',
        features: pts.map((p) => ({
          type: 'Feature',
          properties: {},
          geometry: { type: 'Point', coordinates: p },
        })),
      };
    } else if (mode === 'radius' && circleCenter) {
      const poly = circleToPolygon(circleCenter, radiusM);
      fc = {
        type: 'FeatureCollection',
        features: [{ type: 'Feature', properties: {}, geometry: poly }],
      };
      verts = {
        type: 'FeatureCollection',
        features: [
          { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: circleCenter } },
        ],
      };
    }

    drawSrc.setData(fc);
    vertSrc.setData(verts);
  }, [mode, polygonPoints, hoverPoint, circleCenter, radiusM, mapReady]);

  useEffect(() => { renderDraw(); }, [renderDraw]);

  // Push candidate sites to the map when provided.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const src = map.getSource('candidates');
    if (!src) return;
    src.setData({
      type: 'FeatureCollection',
      features: candidateSites.map((s) => ({
        type: 'Feature',
        properties: { id: s.id, score: s.score ?? null },
        geometry: { type: 'Point', coordinates: [s.lng, s.lat] },
      })),
    });
  }, [candidateSites, mapReady]);

  // ── Mouse / keyboard handlers ─────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const onClick = (e) => {
      const { lng, lat } = e.lngLat;
      if (mode === 'polygon') {
        setPolygonPoints((prev) => [...prev, [lng, lat]]);
      } else if (mode === 'radius') {
        setCircleCenter([lng, lat]);
      }
    };
    const onDblClick = (e) => {
      e.preventDefault?.();
      if (mode === 'polygon' && polygonPointsRef.current.length >= 3) {
        setHoverPoint(null);
        emitGeometry();
      }
    };
    const onMouseMove = (e) => {
      if (mode !== 'polygon') return;
      if (polygonPointsRef.current.length === 0) return;
      setHoverPoint([e.lngLat.lng, e.lngLat.lat]);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') {
        setPolygonPoints([]);
        setHoverPoint(null);
        setCircleCenter(null);
        if (onChange) onChange(null);
      } else if (e.key === 'Enter' && mode === 'polygon' && polygonPointsRef.current.length >= 3) {
        setHoverPoint(null);
        emitGeometry();
      } else if ((e.key === 'Backspace' || e.key === 'z') && mode === 'polygon') {
        setPolygonPoints((prev) => prev.slice(0, -1));
      }
    };

    map.on('click', onClick);
    map.on('dblclick', onDblClick);
    map.on('mousemove', onMouseMove);
    map.doubleClickZoom.disable();
    window.addEventListener('keydown', onKey);
    return () => {
      map.off('click', onClick);
      map.off('dblclick', onDblClick);
      map.off('mousemove', onMouseMove);
      map.doubleClickZoom.enable();
      window.removeEventListener('keydown', onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, mapReady]);

  // Reset drawing when the mode changes.
  useEffect(() => {
    setPolygonPoints([]);
    setHoverPoint(null);
    setCircleCenter(null);
    if (onChange) onChange(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // Emit geometry whenever a completable shape exists.
  const emitGeometry = useCallback(() => {
    if (!onChange) return;
    if (mode === 'polygon') {
      const pts = polygonPointsRef.current;
      if (pts.length < 3) return onChange(null);
      const ring = [...pts, pts[0]];
      onChange({
        type: 'polygon',
        geometry: { type: 'Polygon', coordinates: [ring] },
        areaKm2: polygonAreaKm2(pts),
        vertexCount: pts.length,
      });
    } else if (mode === 'radius') {
      const c = circleCenterRef.current;
      if (!c) return onChange(null);
      onChange({
        type: 'circle',
        geometry: circleToPolygon(c, radiusMRef.current),
        center: c,
        radiusM: radiusMRef.current,
        areaKm2: (Math.PI * radiusMRef.current * radiusMRef.current) / 1_000_000,
      });
    }
  }, [mode, onChange]);

  // Auto-emit for radius mode whenever center/radius changes.
  useEffect(() => {
    if (mode === 'radius') emitGeometry();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [circleCenter, radiusM, mode]);

  // Auto-emit for polygon mode when 3+ points and not actively previewing new vertex.
  useEffect(() => {
    if (mode === 'polygon' && polygonPoints.length >= 3) {
      emitGeometry();
    } else if (mode === 'polygon' && polygonPoints.length < 3) {
      onChange?.(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [polygonPoints, mode]);

  const polygonArea = polygonPoints.length >= 3 ? polygonAreaKm2(polygonPoints) : 0;
  const circleArea = mode === 'radius' && circleCenter
    ? (Math.PI * radiusM * radiusM) / 1_000_000
    : 0;

  const helpText =
    mode === 'polygon'
      ? polygonPoints.length === 0
        ? 'Click to place vertices · Enter / double-click to finish · Esc to clear'
        : `${polygonPoints.length} vertex${polygonPoints.length === 1 ? '' : 'es'} · Double-click / Enter to finish · Backspace undo`
      : circleCenter
        ? 'Drag the slider to adjust radius · Click a new center to move'
        : 'Click anywhere on the map to set center';

  return (
    <div className="scan-map-wrap">
      <div ref={mapContainer} className="scan-map" />
      <div className="scan-map-hud">
        <div className="scan-map-help">{helpText}</div>
        {mode === 'radius' && circleCenter && (
          <div className="scan-map-radius">
            <label className="mono">RADIUS</label>
            <input
              type="range"
              min="100"
              max="3000"
              step="50"
              value={radiusM}
              onChange={(e) => setRadiusM(Number(e.target.value))}
            />
            <span className="mono">{radiusM} m</span>
          </div>
        )}
        {(polygonArea > 0 || circleArea > 0) && (
          <div className="scan-map-stats">
            <span className="mono">AREA</span>
            <span className="mono stat-value">
              {(polygonArea || circleArea).toFixed(2)} km²
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
