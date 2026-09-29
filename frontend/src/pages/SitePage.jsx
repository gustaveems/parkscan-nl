import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import ScoreRing from '../components/ScoreRing';
import { mapStaticUrl, streetViewUrls360, streetViewAvailable } from '../lib/images';
import { scoreLabel } from '../lib/utils';
import './SitePage.css';

// Reconstructed (Sept 2026) to the recovered SitePage.css class contract:
// header + pipeline status, scores banner, BAG/context/map sections,
// ownership + conversion spotlight, street view strip.

const STEPS = ['Identified', 'Enriched', 'Scored', 'Owner', 'Report'];

function statusIndex(status) {
  if (!status) return 0;
  if (status === 'report_ready') return 4;
  if (status === 'owner_found' || status === 'contacted' || status === 'negotiating') return 3;
  if (status === 'scored') return 2;
  if (status === 'enriched') return 1;
  return 0;
}

export default function SitePage() {
  const { id } = useParams();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [tab, setTab] = useState('context');

  const load = () => api.getSite(id).then(setData).catch((e) => setError(e.message));
  useEffect(() => { load(); }, [id]);

  useEffect(() => {
    // Deep-link ?run=1 auto-runs the missing stages (queue "Report Ready" path).
    if (!data || params.get('run') !== '1' || data.report) return;
    (async () => {
      try {
        setBusy('pipeline');
        if (!data.score) await api.scoreSite(id);
        if (!data.owner) await api.lookupOwnership(id);
        await load();
      } catch (e) { setError(e.message); } finally { setBusy(''); }
    })();
  }, [data]); // eslint-disable-line

  async function run(action) {
    setBusy(action); setError('');
    try {
      if (action === 'enrich') await api.enrichSite(id);
      if (action === 'score') await api.scoreSite(id);
      if (action === 'ownership') await api.lookupOwnership(id);
      await load();
    } catch (e) { setError(e.message); }
    finally { setBusy(''); }
  }

  const site = data?.site;
  const score = data?.score;
  const owner = data?.owner;
  const conv = data?.conversion;
  const ctx = site?.context;
  const step = statusIndex(site?.status);

  const sv = useMemo(
    () => (site ? streetViewUrls360(site.lat, site.lng) : []),
    [site],
  );
  const [svOk, setSvOk] = useState(null);
  useEffect(() => {
    if (!site) return;
    let alive = true;
    setSvOk(null);
    streetViewAvailable(site.lat, site.lng).then((v) => alive && setSvOk(v));
    return () => { alive = false; };
  }, [site]);

  if (error && !site) return <div className="site-page"><p className="error">{error}</p></div>;
  if (!site) return <div className="site-page"><p>Loading dossier…</p></div>;

  return (
    <div className="site-page">
      <header className="site-header">
        <div className="site-header-main">
          <div className="site-meta-row mono">
            SCAN {site.scanId} · {site.city.toUpperCase()} / {site.district?.toUpperCase() ?? 'AREA'}
            <span className="dot-sep">·</span>
            <span className="bag-tag">{site.source}</span>
          </div>
          <div className="site-title-row">
            <h1>{site.address}</h1>
            <span className="bag-tag">{site.bagStatus || 'BAG'} </span>
          </div>
          <div className="pipeline-status">
            {STEPS.map((label, i) => (
              <span key={label} className={`ps-step ${i < step ? 'done' : i === step ? 'current' : ''}`}>
                <span className="ps-dot" /><span className="ps-label">{label}</span>
                {i < STEPS.length - 1 && <span className="ps-line" />}
              </span>
            ))}
          </div>
        </div>
        <div className="site-header-actions">
          <button className="btn btn-sm" onClick={() => run('enrich')} disabled={!!busy}>
            {busy === 'enrich' ? '…' : 'Re-enrich'}
          </button>
          <button className="btn btn-sm" onClick={() => run('score')} disabled={!!busy}>Re-score</button>
          <button className="btn btn-sm" onClick={() => run('ownership')} disabled={!!busy}>Owner lookup</button>
          <button className="btn btn-sm btn-primary" disabled={!score || !owner}
                  onClick={() => nav(`/sites/${id}/report`)}>Open Report →</button>
        </div>
      </header>

      <section className="scores-banner">
        <div className="scores-rings">
          <ScoreRing score={score?.vacancyScore ?? 0} size={104} label="Vacancy" sublabel={score ? scoreLabel(score.vacancyScore) : 'unscored'} />
          <ScoreRing score={score?.parkingScore ?? 0} size={104} label="Parking" sublabel={score ? scoreLabel(score.parkingScore) : ''} />
        </div>
        <div className="scores-divider" />
        <div className="signals-list">
          {(score?.reasons ?? []).slice(0, 6).map((r, i) => (
            <div key={i} className={`signal-row ${r.type}`}>
              <span className="ci-icon">{r.type === 'positive' ? '▲' : r.type === 'negative' ? '▼' : '◆'}</span>
              <span className="ci-label">{r.label}</span>
              <span className="signal-weight mono">{r.weight > 0 ? '+' : ''}{r.weight}</span>
            </div>
          ))}
          {!score && <p className="eo-sub">Run scoring to see the weighted reasons.</p>}
        </div>
      </section>

      <div className="tabs-bar">
        {['context', 'bag', 'streetview'].map((t) => (
          <button key={t} className={`tab-btn ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>
            {t === 'bag' ? 'BAG / Kadaster' : t === 'streetview' ? 'Street View 360°' : 'Surroundings'}
          </button>
        ))}
      </div>

      <div className="two-col">
        <div className="section-card tab-content">
          {tab === 'context' && (
            <>
              <h3 className="section-card-title">POI context</h3>
              <div className="context-items">
                <div className="context-item"><span className="ci-value">{ctx?.totalCount ?? '—'}</span><span className="ci-label">nearby POIs</span></div>
                <div className="context-item"><span className="ci-value">{ctx?.transitProximity ? '✓' : '—'}</span><span className="ci-label">transit ≤ 250 m</span></div>
                <div className="context-item"><span className="ci-value">{ctx?.retailProximity ? '✓' : '—'}</span><span className="ci-label">retail core</span></div>
                <div className="context-item"><span className="ci-value">{ctx?.hospitalProximity ? '✓' : '—'}</span><span className="ci-label">hospital zone</span></div>
              </div>
              <div className="map-placeholder">
                <img className="map-real" src={mapStaticUrl(site.lat, site.lng, { size: '600x380' })} alt="Static map" />
                <div className="map-grid">
                  <div className="map-pin-center"><span className="map-pin-label">{site.bagId ?? 'BAG object'}</span></div>
                </div>
              </div>
            </>
          )}
          {tab === 'bag' && (
            <>
              <h3 className="section-card-title">BAG registry</h3>
              <div className="bag-grid">
                {[
                  ['Verblijfsobject', site.bagId],
                  ['Perceel', site.parcelRef],
                  ['Gebruiksfunctie', site.usePurpose],
                  ['Vloeroppervlak', site.areaSqm ? `${site.areaSqm} m²` : null],
                  ['Bouwjaar', site.buildYear],
                  ['Status', site.bagStatus],
                ].map(([k, v]) => (
                  <div key={k} className="bag-field">
                    <span className="bag-field-label">{k}</span>
                    <span className="bag-field-value">{v ?? '—'}</span>
                  </div>
                ))}
              </div>
              <p className="img-attrib">Owners via Kadaster Eigendomsinformatie (illustrative without broker contract).</p>
            </>
          )}
          {tab === 'streetview' && (
            <>
              <h3 className="section-card-title">Frontage survey</h3>
              <div className="streetview-360">
                {sv.map((s) => (
                  <div key={s.label} className="sv-tile">
                    {svOk === false
                      ? <div className="streetview-mock" title={s.label}>
                          <div className="sv-facade"><div className="sv-windows"><i className="sv-window" /><i className="sv-window" /></div><div className="sv-door" /><div className="sv-street" /></div>
                        </div>
                      : <img className="streetview-real" src={s.url} alt={`${s.label} view`} loading="lazy" />}
                    <span className="sv-label mono">{s.short}</span>
                    {site.frontage?.headings?.find((h) => h.short === s.short)?.inactive && <span className="bag-tag">inactive</span>}
                  </div>
                ))}
              </div>
              {site.frontage?.signals?.length > 0 && (
                <div className="context-items">
                  {site.frontage.signals.slice(0, 5).map((sig, i) => (
                    <div key={i} className="context-item"><span className="ci-icon">✦</span><span className="ci-label">{sig}</span></div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        <div className="section-card">
          <h3 className="section-card-title">Ownership &amp; opportunity</h3>
          {owner ? (
            <div className="kv-grid">
              <div className="kv-row"><span className="kv-label">Owner</span><span className="kv-value owner-highlight">{owner.ownerName}</span></div>
              <div className="kv-row"><span className="kv-label">Type</span><span className="kv-value">{owner.ownershipType} · {owner.ownershipConfidence}</span></div>
              <div className="kv-row"><span className="kv-label">Source</span><span className="kv-value">{owner.source}</span></div>
            </div>
          ) : (
            <div className="empty-ownership">
              <span className="eo-icon">?</span>
              <div className="eo-title">Owner not resolved yet</div>
              <div className="eo-sub">Run “Owner lookup” — Kadaster Eigendomsinformatie.</div>
            </div>
          )}

          {conv ? (
            <div className="overview-conversion-body">
              <div className="conversion-hero overview-conv-primary">
                <div className="overview-conv-icon-wrap"><span className="overview-conv-icon">€</span></div>
                <div>
                  <div className="overview-conv-h1">≈ {conv.spacesEst} bays</div>
                  <div className="overview-conv-title">{conv.netRevenueMonthly.toLocaleString()} € net / month</div>
                  <div className="overview-conv-sub">Payback {conv.paybackYears} y · ROI {conv.annualRoiPct}%</div>
                </div>
              </div>
              <div className="conv-divider" />
              <div className="overview-conv-chart revenue-bar-chart">
                {[['Low', conv.revenueLow], ['Base', conv.revenueBase], ['High', conv.revenueHigh]].map(([k, v], i, arr) => (
                  <div key={k} className="rev-bar-row">
                    <span className="rev-bar-label">{k}</span>
                    <div className="rev-bar-track"><div className="rev-bar-fill" style={{ width: `${(v / arr[2][1]) * 100}%` }} /></div>
                    <span className="rev-bar-value mono">€{v.toLocaleString()}</span>
                  </div>
                ))}
              </div>
              <div className="overview-conv-footnote">
                <span className="conv-metric"><span className="conv-num">€{conv.setupCostBase.toLocaleString()}</span> setup</span>
                <span className="conv-metric"><span className="conv-num">{conv.monthlyRatePerSpace} €</span> /bay/mo</span>
                <span className="conv-metric"><span className="conv-num">{conv.sqmPerSpace} m²</span> /bay</span>
              </div>
            </div>
          ) : (
            <div className="overview-conversion-empty">Conversion model appears after scoring + ownership.</div>
          )}
        </div>
      </div>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
