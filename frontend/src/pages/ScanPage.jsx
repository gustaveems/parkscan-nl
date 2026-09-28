import { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  MapPin,
  Radar,
  Building2,
  ChevronRight,
  Pentagon,
  CircleDot,
  Layers,
  Sparkles,
  Navigation,
  ShoppingBag,
  Hospital,
  AlertCircle,
  CheckCircle,
} from 'lucide-react';
import { api } from '../lib/api';
import ScanMap from '../components/ScanMap';
import './ScanPage.css';

const MODES = [
  { id: 'district', label: 'District', icon: Layers, desc: 'Quick preset by named neighbourhood' },
  { id: 'polygon', label: 'Polygon', icon: Pentagon, desc: 'Draw a freehand target area' },
  { id: 'radius', label: 'Radius', icon: CircleDot, desc: 'Circle around a point of interest' },
];

const VERDICT_LABELS = {
  promising: { text: 'Promising area — high vacancy-prone density', color: 'green', Icon: CheckCircle },
  moderate:  { text: 'Moderate — some candidates worth scanning',     color: 'amber', Icon: Sparkles },
  thin:      { text: 'Thin sample — consider widening the area',      color: 'amber', Icon: AlertCircle },
  no_candidates: { text: 'No candidates found in this area',          color: 'red',   Icon: AlertCircle },
};

const PURPOSE_SHORT = {
  kantoorfunctie: 'Office',
  winkelfunctie: 'Retail',
  industriefunctie: 'Industrial',
  celfunctie: 'Storage',
  gezondheidszorgfunctie: 'Healthcare',
  logiesfunctie: 'Lodging',
  onderwijsfunctie: 'Education',
  sportfunctie: 'Sport',
  'overige gebruiksfunctie': 'Other',
  woonfunctie: 'Residential',
};

export default function ScanPage() {
  const [cities, setCities] = useState([]);
  const [selectedCity, setSelectedCity] = useState('');
  const [selectedDistrict, setSelectedDistrict] = useState('');
  const [mode, setMode] = useState('district');
  const [drawnArea, setDrawnArea] = useState(null);
  const [loading, setLoading] = useState(false);
  const [recentScans, setRecentScans] = useState([]);
  const [preview, setPreview] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const previewSeqRef = useRef(0);
  const navigate = useNavigate();

  useEffect(() => {
    api.getCities().then((d) => {
      setCities(d.cities);
      if (d.cities.length && !selectedCity) setSelectedCity(d.cities[0].id);
    });
    api.getScans().then((d) => setRecentScans(d.scans.slice(0, 5)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Debounced preview — fires when the city + (district | drawn area) is set,
  // so the operator sees a tiny "estimated 24 candidates · 2 transit hubs"
  // panel before committing to a real scan.
  useEffect(() => {
    setPreview(null);
    if (!selectedCity) return;
    const hasTarget =
      (mode === 'district' && selectedDistrict) ||
      (mode !== 'district' && drawnArea);
    if (!hasTarget) return;

    const seq = ++previewSeqRef.current;
    setPreviewLoading(true);
    const timer = setTimeout(async () => {
      try {
        const result = await api.previewScan({
          city: selectedCity,
          district: mode === 'district' ? selectedDistrict : null,
          area: mode !== 'district' ? drawnArea : null,
        });
        if (seq === previewSeqRef.current) setPreview(result);
      } catch (err) {
        if (seq === previewSeqRef.current) setPreview(null);
      } finally {
        if (seq === previewSeqRef.current) setPreviewLoading(false);
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [selectedCity, selectedDistrict, mode, drawnArea]);

  const cityData = useMemo(
    () => cities.find((c) => c.id === selectedCity),
    [cities, selectedCity]
  );

  const mapCenter = cityData?.center || [52.3676, 4.9041];
  const mapZoom = mode === 'radius' ? 13 : 12;

  const canScan =
    !!selectedCity &&
    (
      (mode === 'district' && !!selectedDistrict) ||
      (mode !== 'district' && !!drawnArea)
    );

  async function handleScan() {
    if (!canScan) return;
    setLoading(true);
    try {
      const payload = {
        city: selectedCity,
        district: mode === 'district' ? selectedDistrict : null,
        area: mode !== 'district' ? drawnArea : null,
      };
      const { scan } = await api.createScan(payload);
      await api.scoreAll(scan.id);
      navigate(`/queue?scanId=${scan.id}`);
    } catch (e) {
      alert(e.message);
    } finally {
      setLoading(false);
    }
  }

  const areaSummary = (() => {
    if (mode === 'district') {
      return selectedDistrict
        ? `District: ${selectedDistrict}`
        : 'Select a named district';
    }
    if (!drawnArea) {
      return mode === 'polygon'
        ? 'Draw a polygon on the map'
        : 'Click the map to set a radius center';
    }
    if (drawnArea.type === 'polygon') {
      return `Polygon · ${drawnArea.vertexCount} vertices · ${drawnArea.areaKm2.toFixed(2)} km²`;
    }
    return `Circle · r=${drawnArea.radiusM} m · ${drawnArea.areaKm2.toFixed(2)} km²`;
  })();

  return (
    <div className="scan-page">
      <div className="scan-header">
        <div className="scan-header-icon"><Radar size={20} /></div>
        <div>
          <h1>New Area Scan</h1>
          <p>Pick a city, target an area, and resolve candidate buildings</p>
        </div>
      </div>

      <div className="scan-body">
        <div className="scan-form card">
          <div className="form-section">
            <label className="form-label">City</label>
            <div className="city-grid">
              {cities.map((c) => (
                <button
                  key={c.id}
                  className={`city-btn${selectedCity === c.id ? ' selected' : ''}`}
                  onClick={() => { setSelectedCity(c.id); setSelectedDistrict(''); setDrawnArea(null); }}
                >
                  <MapPin size={14} />
                  {c.name}
                </button>
              ))}
            </div>
          </div>

          <div className="form-section">
            <label className="form-label">Targeting Mode</label>
            <div className="mode-tabs">
              {MODES.map((m) => {
                const Icon = m.icon;
                return (
                  <button
                    key={m.id}
                    className={`mode-tab${mode === m.id ? ' selected' : ''}`}
                    onClick={() => { setMode(m.id); setDrawnArea(null); setSelectedDistrict(''); }}
                  >
                    <Icon size={14} />
                    <span>{m.label}</span>
                  </button>
                );
              })}
            </div>
            <div className="mode-desc">
              {MODES.find((m) => m.id === mode)?.desc}
            </div>
          </div>

          {mode === 'district' && cityData && (
            <div className="form-section">
              <label className="form-label">District</label>
              <div className="district-grid">
                {cityData.districts.map((d) => (
                  <button
                    key={d}
                    className={`district-btn${selectedDistrict === d ? ' selected' : ''}`}
                    onClick={() => setSelectedDistrict(d)}
                  >
                    {d}
                  </button>
                ))}
              </div>
            </div>
          )}

          {mode !== 'district' && cityData && (
            <div className="form-section">
              <label className="form-label">Target Area</label>
              <ScanMap
                mode={mode}
                center={mapCenter}
                zoom={mapZoom}
                onChange={setDrawnArea}
              />
            </div>
          )}

          <div className="form-section">
            <div className="scan-summary">
              <div className="summary-row">
                <Building2 size={14} />
                <span>~24 candidate buildings will be resolved</span>
              </div>
              <div className="summary-row">
                <MapPin size={14} />
                <span>{areaSummary}</span>
              </div>
              <div className="summary-row">
                <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                  Sources: PDOK Locatieserver · BAG OGC API · Google Maps Platform · Gemini · Cloud Vision
                </span>
              </div>
            </div>

            {/* ── Smart preview card (Feature 8) — appears once a target area
                 is set, before the user commits to a scan ───────────────── */}
            {(previewLoading || preview) && (
              <div className="scan-preview-card">
                {previewLoading ? (
                  <div className="scan-preview-loading">
                    <span className="spinner" />
                    <span>Sampling candidates and nearby POIs…</span>
                  </div>
                ) : preview ? (
                  <>
                    <div className="scan-preview-header">
                      <Sparkles size={14} />
                      <span>Smart preview</span>
                      {preview.verdict && VERDICT_LABELS[preview.verdict] && (() => {
                        const v = VERDICT_LABELS[preview.verdict];
                        const VIcon = v.Icon;
                        return (
                          <span className={`scan-preview-verdict scan-preview-verdict-${v.color}`}>
                            <VIcon size={11} /> {v.text}
                          </span>
                        );
                      })()}
                    </div>
                    <div className="scan-preview-grid">
                      <div className="scan-preview-stat">
                        <div className="scan-preview-num">{preview.estimatedCount}</div>
                        <div className="scan-preview-label">est. candidates</div>
                      </div>
                      <div className="scan-preview-stat">
                        <div className="scan-preview-num">
                          {preview.vacancyProneCount}
                          <span className="scan-preview-num-sub">/{preview.sampleSize}</span>
                        </div>
                        <div className="scan-preview-label">vacancy-prone in sample</div>
                      </div>
                      <div className="scan-preview-stat">
                        <div className="scan-preview-num">{preview.context.totalCount}</div>
                        <div className="scan-preview-label">POIs at centroid</div>
                      </div>
                    </div>
                    <div className="scan-preview-chips">
                      <span
                        className={`scan-preview-chip${preview.context.transitProximity ? ' active' : ''}`}
                      >
                        <Navigation size={11} />
                        Transit {preview.context.transitProximity ? '✓' : '—'}
                      </span>
                      <span
                        className={`scan-preview-chip${preview.context.retailProximity ? ' active' : ''}`}
                      >
                        <ShoppingBag size={11} />
                        Retail {preview.context.retailProximity ? '✓' : '—'}
                      </span>
                      <span
                        className={`scan-preview-chip${preview.context.hospitalProximity ? ' active' : ''}`}
                      >
                        <Hospital size={11} />
                        Hospital {preview.context.hospitalProximity ? '✓' : '—'}
                      </span>
                    </div>
                    {preview.purposes.length > 0 && (
                      <div className="scan-preview-purposes">
                        <div className="scan-preview-sublabel">Sample use purposes</div>
                        <div className="scan-preview-purpose-row">
                          {preview.purposes.map((p) => (
                            <span key={p.purpose} className="scan-preview-purpose-pill">
                              {PURPOSE_SHORT[p.purpose] || p.purpose}
                              <span className="mono"> {p.count}</span>
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                ) : null}
              </div>
            )}

            <button
              className="btn btn-primary btn-lg scan-btn"
              disabled={!canScan || loading || preview?.verdict === 'no_candidates'}
              onClick={handleScan}
            >
              {loading ? (
                <><span className="spinner" /> Scanning & scoring...</>
              ) : (
                <><Radar size={16} /> Start Scan</>
              )}
            </button>
          </div>
        </div>

        {recentScans.length > 0 && (
          <div className="recent-scans">
            <div className="section-title">Recent Scans</div>
            {recentScans.map((scan) => (
              <button
                key={scan.id}
                className="recent-scan-row card"
                onClick={() => navigate(`/queue?scanId=${scan.id}`)}
              >
                <div className="recent-scan-info">
                  <span className="mono" style={{ color: 'var(--accent-2)', fontSize: 11 }}>{scan.id}</span>
                  <span style={{ fontWeight: 600 }}>
                    {scan.city} — {scan.district || scan.areaLabel || 'custom area'}
                  </span>
                  <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                    {scan.siteCount} sites · {new Date(scan.createdAt).toLocaleDateString('nl-NL')}
                  </span>
                </div>
                <ChevronRight size={14} style={{ color: 'var(--text-muted)' }} />
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="pipeline-visual">
        <div className="pipeline-title">System Flow</div>
        <div className="pipeline-steps">
          {[
            { label: 'Target Area', sub: 'MapLibre + OSM', color: 'var(--accent)' },
            { label: 'Address Match', sub: 'PDOK Locatieserver', color: 'var(--accent)' },
            { label: 'Building Facts', sub: 'BAG OGC API', color: 'var(--accent)' },
            { label: 'Scoring', sub: 'Vacancy Engine', color: 'var(--amber)' },
            { label: 'Ownership', sub: 'Kadaster', color: 'var(--orange)' },
            { label: 'Report + CRM', sub: 'PDF + Outreach', color: 'var(--green)' },
          ].map((s, i) => (
            <div key={i} className="pipeline-step">
              <div className="step-dot" style={{ background: s.color }} />
              <div className="step-label">{s.label}</div>
              <div className="step-sub">{s.sub}</div>
              {i < 5 && <div className="step-arrow">›</div>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
