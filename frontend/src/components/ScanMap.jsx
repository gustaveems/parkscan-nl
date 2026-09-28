import { useEffect, useRef, useState, useCallback } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import './ScanMap.css';

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
  layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
};

const EMPTY_FC = { type: 'FeatureCollection', features: [] };
const ACCENT = '#3b82f6';

function toGeoRing(center, radiusM, steps = 64) {
  const [lat, lng] = center;
  const ring = [];
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * 2 * Math.PI;
    const dLat = (radiusM * Math.sin(a)) / 111320;
    const dLng = (radiusM * Math.cos(a)) / (111320 * Math.cos((lat * Math.PI) / 180));
    ring.push([lng + dLng, lat + dLat]);
  }
  return ring;
}

function polygonAreaKm2(points) {
  if (points.length < 3) return 0;
  const lat0 = points.reduce((s, p) => s + p[0], 0) / points.length;
  const mPerDegLat = 111320;
  const mPerDegLng = 111320 * Math.cos((lat0 * Math.PI) / 180);
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const [la1, ln1] = points[i];
    const [la2, ln2] = points[(i + 1) % points.length];
    const x1 = ln1 * mPerDegLng, y1 = la1 * mPerDegLat;
    const x2 = ln2 * mPerDegLng, y2 = la2 * mPerDegLat;
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum / 2) / 1e6;
}

export default function ScanMap({ mode, center = [52.3676, 4.9041], zoom = 12, onChange }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const radiusRef = useRef(500);
  const [radiusM, setRadiusM] = useState(500);
  const [vertices, setVertices] = useState([]);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  radiusRef.current = radiusM;

  const emitCircle = useCallback(
    (lat, lng, r) => {
      onChangeRef.current?.({
        type: 'circle',
        center: [lng, lat],
        radiusM: r,
        areaKm2: (Math.PI * r * r) / 1e6,
      });
    },
    []
  );

  const emitPolygon = useCallback((pts) => {
    if (pts.length < 3) {
      onChangeRef.current?.(null);
      return;
    }
    const ring = [...pts.map(([lat, lng]) => [lng, lat]), [pts[0][1], pts[0][0]]];
    onChangeRef.current?.({
      type: 'polygon',
      geometry: { type: 'Polygon', coordinates: [ring] },
      vertexCount: pts.length,
      areaKm2: polygonAreaKm2(pts),
    });
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: MAP_STYLE,
      center: [center[1], center[0]],
      zoom,
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    mapRef.current = map;

    map.on('load', () => {
      map.addSource('draw', { type: 'geojson', data: EMPTY_FC });
      map.addSource('draw-vertices', { type: 'geojson', data: EMPTY_FC });
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
        paint: { 'line-color': ACCENT, 'line-width': 2 },
      });
      map.addLayer({
        id: 'draw-vertices',
        type: 'circle',
        source: 'draw-vertices',
        paint: { 'circle-radius': 4, 'circle-color': '#fff', 'circle-stroke-color': ACCENT, 'circle-stroke-width': 2 },
      });
    });

    map.on('click', (e) => {
      if (mapModeRef.current === 'polygon') {
        setVertices((prev) => {
          const next = [...prev, [e.lngLat.lat, e.lngLat.lng]];
          emitPolygon(next);
          return next;
        });
      } else if (mapModeRef.current === 'radius') {
        emitCircle(e.lngLat.lat, e.lngLat.lng, radiusRef.current);
      }
    });

    map.on('dblclick', () => {
      if (mapModeRef.current === 'polygon' && verticesRef.current.length >= 3) {
        map.doubleClickZoom.disable();
        setTimeout(() => map.doubleClickZoom.enable(), 0);
      }
    });

    return () => map.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const mapModeRef = useRef(mode);
  const verticesRef = useRef(vertices);
  mapModeRef.current = mode;
  verticesRef.current = vertices;

  // Redraw layers when state changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    const draw = () => map.getSource('draw');
    const verts = () => map.getSource('draw-vertices');

    if (mode === 'radius') {
      const setCircle = () => {
        const c = map.getCenter();
        const ring = toGeoRing([c.lat, c.lng], radiusRef.current);
        draw()?.setData({
          type: 'FeatureCollection',
          features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ring] } }],
        });
        verts()?.setData({
          type: 'FeatureCollection',
          features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [c.lng, c.lat] } }],
        });
        emitCircle(c.lat, c.lng, radiusRef.current);
      };
      setCircle();
      map.on('moveend', setCircle);
      return () => map.off('moveend', setCircle);
    }
    if (mode === 'polygon') {
      if (vertices.length >= 3) {
        const ring = [...vertices.map(([lat, lng]) => [lng, lat]), [vertices[0][1], vertices[0][0]]];
        draw()?.setData({
          type: 'FeatureCollection',
          features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ring] } }],
        });
      } else if (vertices.length >= 1) {
        draw()?.setData({
          type: 'FeatureCollection',
          features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: vertices.map(([lat, lng]) => [lng, lat]) } }],
        });
      } else {
        draw()?.setData(EMPTY_FC);
      }
      verts()?.setData({
        type: 'FeatureCollection',
        features: vertices.map(([lat, lng]) => ({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [lng, lat] } })),
      });
      return undefined;
    }
    draw()?.setData(EMPTY_FC);
    verts()?.setData(EMPTY_FC);
    return undefined;
  }, [mode, radiusM, vertices, emitCircle]);

  // Recenter + reset when city changes
  useEffect(() => {
    const map = mapRef.current;
    if (map && center) map.flyTo({ center: [center[1], center[0]], zoom, essential: true });
    setVertices([]);
    onChangeRef.current?.(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [center[0], center[1]]);

  const areaKm2 =
    mode === 'radius'
      ? (Math.PI * radiusM * radiusM) / 1e6
      : polygonAreaKm2(vertices);

  return (
    <div className="scan-map-wrap">
      <div ref={containerRef} className="scan-map" />
      <div className="scan-map-hud">
        {mode === 'radius' && (
          <div className="scan-map-radius">
            <label className="form-label mono">RADIUS</label>
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
        {mode === 'polygon' && (
          <div className="scan-map-radius">
            <button className="btn btn-sm btn-ghost" onClick={() => setVertices((v) => v.slice(0, -1))}>
              Undo vertex
            </button>
            <button className="btn btn-sm btn-ghost" onClick={() => setVertices([])}>
              Clear
            </button>
          </div>
        )}
        <div className="scan-map-stats mono">
          {mode === 'radius' && <span>click map to move centre</span>}
          {mode === 'polygon' && <span>{vertices.length} vertices — click to add</span>}
          {vertices.length > 0 || mode === 'radius' ? <span>≈ {areaKm2.toFixed(2)} km²</span> : null}
        </div>
      </div>
      <div className="scan-map-help mono">
        {mode === 'radius'
          ? 'Drag the map + slider to frame the block, then run the scan.'
          : 'Click to drop polygon vertices around the target block.'}
      </div>
    </div>
  );
}
