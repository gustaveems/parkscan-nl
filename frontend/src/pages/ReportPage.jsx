import { useState, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft, Mail, Send, CheckCircle, AlertCircle,
  Building2, MapPin, TrendingUp, Users, Copy, Check, Download,
  Navigation, ShoppingBag, Hospital, RotateCcw, Ban,
  ThumbsUp, ThumbsDown, Clock4,
} from 'lucide-react';
import { api } from '../lib/api';
import {
  scoreLabel, formatEur, statusLabel, statusBadge, confidenceBadge,
  outreachBadge, outreachLabel, canApproveOutreach, canRetryOutreach,
  canSkipOutreach, canSimulateReply,
} from '../lib/utils';
import { mapStaticUrl, streetViewUrls360, streetViewAvailable } from '../lib/images';
import ScoreRing from '../components/ScoreRing';
import './ReportPage.css';

const CRM_STAGES = [
  { key: 'identified', label: 'Identified' },
  { key: 'reviewed', label: 'Reviewed' },
  { key: 'owner_found', label: 'Owner Found' },
  { key: 'report_ready', label: 'Report Ready' },
  { key: 'contacted', label: 'Contacted' },
  { key: 'negotiating', label: 'Negotiating' },
];

const USE_LABELS = {
  kantoorfunctie: 'Kantoor (Office)',
  winkelfunctie: 'Winkel (Retail)',
  industriefunctie: 'Industrie (Industrial)',
  celfunctie: 'Cel / Opslag (Storage)',
  gezondheidszorgfunctie: 'Gezondheidszorg (Healthcare)',
  logiesfunctie: 'Logies (Lodging)',
  onderwijsfunctie: 'Onderwijs (Education)',
  sportfunctie: 'Sport',
  'overige gebruiksfunctie': 'Overig (Other)',
  woonfunctie: 'Woon (Residential)',
};

export default function ReportPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const printMode = searchParams.get('print') === '1';

  const [data, setData] = useState(null);
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [emailDraft, setEmailDraft] = useState('');
  const [emailSubject, setEmailSubject] = useState('');
  const [sending, setSending] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sent, setSent] = useState(false);
  const [copied, setCopied] = useState(false);
  const [svAvailable, setSvAvailable] = useState(null);
  const [error, setError] = useState('');
  const [portfolio, setPortfolio] = useState(null);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const [siteData, reportData] = await Promise.all([
        api.getSite(id),
        api.getReport(id),
      ]);
      setData(siteData);
      setReport(reportData.report);
      const outreach = reportData.report?.outreach || siteData.outreach;
      setEmailDraft(outreach?.draft || '');
      setEmailSubject(outreach?.subject || '');
      setSent(outreach?.status === 'sent');
    } catch (e) {
      console.error(e);
      setError(e.message || 'Failed to load report');
    } finally {
      setLoading(false);
    }
  }

  // eslint-disable-next-line react-hooks/set-state-in-effect, react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [id]);

  // Owner clustering — once we know the owner name, look up every other site
  // in the system that's been linked to the same owner. Skips silently on error
  // so a missing endpoint doesn't break the report.
  useEffect(() => {
    const ownerName = report?.owner?.ownerName || data?.owner?.ownerName;
    if (!ownerName) return;
    let cancelled = false;
    api.getOwnerPortfolio(ownerName)
      .then((p) => { if (!cancelled) setPortfolio(p); })
      .catch(() => { if (!cancelled) setPortfolio(null); });
    return () => { cancelled = true; };
  }, [report?.owner?.ownerName, data?.owner?.ownerName]);

  useEffect(() => {
    const site = data?.site;
    if (!site) return;
    let cancelled = false;
    streetViewAvailable(site.lat, site.lng).then((ok) => {
      if (!cancelled) setSvAvailable(ok);
    });
    return () => { cancelled = true; };
  }, [data?.site]);

  async function handleSendEmail() {
    setSending(true);
    try {
      await api.updateOutreach(id, { draft: emailDraft, subject: emailSubject });
      await api.approveOutreachSend(id);
      await load();
    } finally {
      setSending(false);
    }
  }

  async function handleSaveDraft() {
    setSaving(true);
    try {
      await api.updateOutreach(id, { draft: emailDraft, subject: emailSubject });
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function handleRetry() {
    setSending(true);
    try {
      await api.updateOutreach(id, { draft: emailDraft, subject: emailSubject });
      await api.retryOutreach(id);
      await load();
    } finally {
      setSending(false);
    }
  }

  async function handleSkip() {
    setSending(true);
    try {
      await api.skipOutreach(id);
      await load();
    } finally {
      setSending(false);
    }
  }

  async function handleSimulateReply(outcome) {
    setSending(true);
    try {
      await api.simulateReply(id, outcome);
      await load();
    } finally {
      setSending(false);
    }
  }

  async function handleCopy() {
    await navigator.clipboard.writeText(emailDraft);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', gap: 12, color: 'var(--text-muted)' }}>
        <span className="spinner" style={{ width: 24, height: 24 }} />
        Loading report...
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: 'var(--red)' }}>
        {error}
      </div>
    );
  }

  if (!data || !report) return null;

  const { site, score, owner, conversion, outreach } = report;
  const currentStageIdx = CRM_STAGES.findIndex(s => s.key === site?.status);
  const pdfHref = `/api/sites/${id}/report.pdf`;
  const svUrls = site ? streetViewUrls360(site.lat, site.lng, { size: '1000x500' }) : [];

  // Pre-compute POI signal flags so the Context section reads cleanly.
  const has = (signal) => Boolean(score?.reasons?.find((r) => r.signal === signal));
  const ctx = {
    transit: has('transit_proximity'),
    retail: has('retail_proximity'),
    hospital: has('hospital_proximity'),
    lowActivity: has('low_activity_context'),
    inactiveFrontage: has('inactive_frontage'),
  };

  const generated = new Date(report.generatedAt).toLocaleString('nl-NL');

  // Source-of-truth badges in the metadata footer reflect which provider
  // actually produced this report's outreach + vision signals (persisted on
  // the records, not read from current env).
  const outreachProvider = outreach?.provider || data.outreach?.provider || 'mock';
  const visionProvider = data.site?.frontage?.provider || 'mock';
  const llmSourceLabel =
    outreachProvider === 'gemini_api'    ? 'Gemini API (live)'   :
    outreachProvider === 'vertex_gemini' ? 'Vertex AI Gemini'    :
    'Mock LLM';
  const visionSourceLabel =
    visionProvider === 'vision_api_key' ? 'Cloud Vision (live)' :
    visionProvider === 'vision_sa'      ? 'Cloud Vision (SA)'   :
    'Mock Vision';
  const llmBadgeClass    = outreachProvider === 'mock' ? 'badge-muted' : 'badge-green';
  const visionBadgeClass = visionProvider === 'mock'    ? 'badge-muted' : 'badge-green';
  const allowApprove = canApproveOutreach(outreach);
  const allowRetry = canRetryOutreach(outreach);
  const allowSkip = canSkipOutreach(outreach);
  const allowSimulateReply = canSimulateReply(outreach);
  const roiMonthsLabel = formatMonths(conversion?.roiMonths);
  const paybackLabel = conversion?.paybackYears ? `${conversion.paybackYears} yrs` : roiMonthsLabel;
  const spacesRange = conversion?.spacesLow && conversion?.spacesHigh
    ? `${conversion.spacesLow}-${conversion.spacesHigh}`
    : `~${conversion?.spacesEst ?? 0}`;

  return (
    <div className={`report-page${printMode ? ' print-mode' : ''}`}>

      {/* Top action bar — hidden in print mode */}
      {!printMode && (
        <div className="report-toolbar">
          <button className="btn btn-ghost btn-sm" onClick={() => navigate(`/sites/${id}`)}>
            <ArrowLeft size={14} /> Site Detail
          </button>
          <div style={{ flex: 1 }} />
          <a className="btn btn-secondary btn-sm" href={`${pdfHref}?download=1`} target="_blank" rel="noreferrer">
            <Download size={12} /> Download PDF
          </a>
        </div>
      )}

      {/* Document */}
      <article className="report-doc">

        {/* ── 1. Title block ─────────────────────────────────────────── */}
        <header className="rd-title">
          <div className="rd-brand-row">
            <span className="rd-brand-mark">P</span>
            <div className="rd-brand-text">
              <div className="rd-brand-name">ParkScan NL</div>
              <div className="rd-brand-sub">SULC Advisors · Site Dossier</div>
            </div>
          </div>
          <h1 className="rd-title-h1">{site?.address}</h1>
          <div className="rd-title-meta">
            <span className={`badge ${statusBadge(site?.status)}`}>{statusLabel(site?.status)}</span>
            <span className="rd-meta-sep">·</span>
            <span className="mono">{site?.bagId}</span>
            <span className="rd-meta-sep">·</span>
            <span>{site?.district ? `${site.district}, ` : ''}{site?.city?.charAt(0).toUpperCase()}{site?.city?.slice(1)}</span>
            <span className="rd-meta-sep">·</span>
            <span>Generated {generated}</span>
          </div>
        </header>

        {/* ── 2. Parking Investment Case — the decision-maker view ───── */}
        {conversion && (
          <Card title="Parking Investment Case" icon={<TrendingUp size={12} />}>
            <div className="rd-opportunity-hero">
              <div className="rd-opportunity-primary">
                <div className="rd-opportunity-kicker">Estimated capacity</div>
                <div className="rd-opportunity-value">{conversion.spacesEst}</div>
                <div className="rd-opportunity-sub">parking spaces ({spacesRange} likely range)</div>
              </div>
              <div className="rd-opportunity-grid">
                <Metric label="Monthly gross" value={formatEur(conversion.revenueBase)} tone="green" />
                <Metric label="Monthly net" value={formatEur(conversion.netRevenueMonthly)} tone="green" />
                <Metric label="Annual net" value={formatEur(conversion.annualNetRevenue)} tone="accent" />
                <Metric label="Setup cost" value={formatEur(conversion.setupCostBase || conversion.setupCostHigh)} tone="amber" />
                <Metric label="Payback" value={paybackLabel} />
                <Metric label="Annual ROI" value={formatPct(conversion.annualRoiPct)} tone="green" />
              </div>
            </div>
            <div className="rd-investment-note">
              Model assumes {conversion.usableAreaSqm ?? 'estimated'}m² usable area, {conversion.sqmPerSpace ?? '27-32'}m² per bay,
              {conversion.occupancyBase ? ` ${Math.round(conversion.occupancyBase * 100)}%` : ''} base occupancy,
              and {formatEur(conversion.monthlyRatePerSpace)}/space/month.
            </div>
          </Card>
        )}

        {/* ── 3. Scores ──────────────────────────────────────────────── */}
        {score && (
          <Card title="Scores" icon={<TrendingUp size={12} />}>
            <div className="rd-scores-row">
              <ScoreRing score={score.vacancyScore} size={90} label="Vacancy" sublabel={scoreLabel(score.vacancyScore)} />
              <ScoreRing score={score.parkingScore} size={90} label="Parking" sublabel={scoreLabel(score.parkingScore)} />
              <div className="rd-scores-meta">
                <Field label="Confidence" value={
                  <span className={`badge ${confidenceBadge(score.confidence)}`}>{score.confidence}</span>
                } />
                <Field label="Model" value={<span className="mono">v{score.modelVersion}</span>} />
                <Field label="Scored" value={new Date(score.scoredAt).toLocaleString('nl-NL')} />
              </div>
            </div>
          </Card>
        )}

        {/* ── 4. All Score Signals (full reasons list) ──────────────── */}
        {score?.reasons?.length > 0 && (
          <Card title="Score Signals">
            <div className="rd-signals">
              {score.reasons.map((r, i) => (
                <div key={i} className={`rd-signal rd-signal--${r.type}`}>
                  {r.type === 'positive' || r.type === 'parking' ? (
                    <CheckCircle size={12} />
                  ) : (
                    <AlertCircle size={12} />
                  )}
                  <span className="rd-signal-label">{r.label}</span>
                  <span className="rd-signal-source">
                    {r.source ? `· ${r.source}` : ''}
                  </span>
                  <span className={`rd-signal-weight ${r.weight < 0 ? 'neg' : 'pos'}`}>
                    {r.weight > 0 ? '+' : ''}{r.weight}
                  </span>
                </div>
              ))}
            </div>
          </Card>
        )}

        {/* ── 5. Building Facts — BAG (full record) ─────────────────── */}
        <Card title="Building Facts — BAG" icon={<Building2 size={12} />}>
          <div className="rd-tag-row">
            <span className="badge badge-blue">PDOK BAG OGC API</span>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Daily updated · Open data</span>
          </div>
          <div className="rd-grid rd-grid-3">
            <Field label="Address" value={site?.address} />
            <Field label="Straat" value={site?.street} />
            <Field label="Huisnummer" value={site?.houseNumber} />
            <Field label="Postcode" value={site?.postcode} mono />
            <Field label="Woonplaats" value={site?.city?.charAt(0).toUpperCase() + site?.city?.slice(1)} />
            <Field label="District" value={site?.district || '—'} />
            <Field label="Verblijfsobject ID (BAG)" value={site?.bagId} mono />
            <Field label="Kadastrale perceel" value={site?.parcelRef} mono />
            <Field label="Gebruiksdoel" value={USE_LABELS[site?.usePurpose] || site?.usePurpose} />
            <Field label="Oppervlakte" value={`${site?.areaSqm} m²`} />
            <Field label="Bouwjaar" value={site?.buildYear} />
            <Field label="BAG Status" value={site?.bagStatus} />
            <Field label="Latitude" value={site?.lat?.toFixed(6)} mono />
            <Field label="Longitude" value={site?.lng?.toFixed(6)} mono />
          </div>
        </Card>

        {/* ── 6. Visual Survey: wide map + 4-up Street View ─────────── */}
        <Card title="Visual Survey" icon={<MapPin size={12} />}>
          <div className="rd-visual-block">
            <div className="rd-visual-label">Map (Google Maps Static)</div>
            <div className="rd-visual-img-wrap rd-visual-img-tall">
              {site && (
                <img
                  src={mapStaticUrl(site.lat, site.lng, { zoom: 18, size: '1200x500' })}
                  alt={`Map of ${site.address}`}
                />
              )}
              {site && (
                <div className="rd-visual-coords">
                  {site.lat.toFixed(5)}, {site.lng.toFixed(5)}
                </div>
              )}
            </div>
          </div>
          <div className="rd-visual-block">
            <div className="rd-visual-label">Street View — 360° Survey (Google Street View Static)</div>
            {svAvailable === false ? (
              <div className="rd-visual-img-wrap"><div className="rd-visual-missing">No Street View imagery at this location.</div></div>
            ) : (
              <div className="rd-sv-grid">
                {svUrls.map((v) => (
                  <div key={v.heading} className="rd-sv-tile">
                    <img src={v.url} alt={`${v.label} view of ${site?.address}`} />
                    <div className="rd-sv-badge">{v.short} · {v.label}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Card>

        {/* ── 7. Context — POIs + Demand signals ─────────────────────── */}
        <Card title="Context — Nearby POIs & Demand" icon={<Navigation size={12} />}>
          <div className="rd-tag-row">
            <span className="badge badge-blue">Google Places API (New)</span>
          </div>
          <div className="rd-grid rd-grid-2">
            <ContextRow icon={<Navigation size={13} />} label="Transit Proximity"
              value={ctx.transit ? 'Yes — within 250m' : 'No'} positive={ctx.transit} />
            <ContextRow icon={<ShoppingBag size={13} />} label="Retail Cluster"
              value={ctx.retail ? 'Yes — nearby' : 'No'} positive={ctx.retail} />
            <ContextRow icon={<Hospital size={13} />} label="Hospital Proximity"
              value={ctx.hospital ? 'Yes — within 250m' : 'No'} positive={ctx.hospital} />
            <ContextRow icon={<Building2 size={13} />} label="Area Activity"
              value={ctx.lowActivity ? 'Low — sparse POIs' : 'Moderate to high'} positive={!ctx.lowActivity} />
          </div>
          {(ctx.transit || ctx.retail || ctx.hospital) && (
            <div className="rd-demand">
              <div className="rd-demand-title">Demand interpretation</div>
              {ctx.transit && (
                <p>Transit hub nearby — commuter parking demand likely; hourly and monthly permit revenue potential is high.</p>
              )}
              {ctx.retail && (
                <p>Retail cluster — visitor parking demand on weekdays and weekends; short-stay revenue model suitable.</p>
              )}
              {ctx.hospital && (
                <p>Hospital nearby — inelastic demand; staff permits and visitor short-stay are both viable.</p>
              )}
            </div>
          )}
          {ctx.inactiveFrontage && (
            <div className="rd-frontage-note">
              Street View analysis suggests <strong>inactive frontage</strong> — no visible signage,
              shuttered windows, or inactive entrance.
            </div>
          )}
        </Card>

        {/* ── 8. Ownership — Kadaster ────────────────────────────────── */}
        {owner && (
          <Card title="Ownership — Kadaster" icon={<Users size={12} />}>
            <div className="rd-tag-row">
              <span className="badge badge-green">Retrieved</span>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                {new Date(owner.retrievedAt).toLocaleString('nl-NL')} · Source: Kadaster
              </span>
            </div>
            <div className="rd-owner-highlight">
              <div className="rd-owner-eyebrow">Eigenaar</div>
              <div className="rd-owner-name">{owner.ownerName}</div>
            </div>
            <div className="rd-grid rd-grid-2" style={{ marginTop: 12 }}>
              <Field label="Ownership Type" value={owner.ownershipType} />
              <Field label="Confidence" value={owner.ownershipConfidence} />
              <Field label="Parcel Reference" value={owner.parcelRef} mono />
              <Field label="Restrictions"
                value={owner.restrictions?.length > 0 ? owner.restrictions.join(', ') : 'None registered'} />
            </div>
            <div className="rd-disclaimer">
              <strong>Note:</strong> Ownership data shown is illustrative.
              Production lookups via the official Kadaster Eigendomsinformatie service
              are pending the SULC broker agreement.
            </div>
          </Card>
        )}

        {/* ── 8b. Owner Portfolio — other sites linked to the same owner ── */}
        {owner && portfolio && portfolio.sites.length > 1 && (
          <Card title="Owner Portfolio" icon={<Building2 size={12} />}>
            <div className="rd-portfolio-intro">
              <strong>{owner.ownerName}</strong> appears on{' '}
              <span className="rd-portfolio-count">{portfolio.sites.length}</span>{' '}
              sites in ParkScan — including this one. The {portfolio.sites.length - 1} other
              {portfolio.sites.length - 1 === 1 ? ' site' : ' sites'} below could form part of
              a portfolio-level conversation rather than separate outreach threads.
            </div>
            <div className="rd-portfolio-grid">
              {portfolio.sites
                .filter((s) => s.siteId !== id)
                .slice(0, 6)
                .map((s) => {
                  const v = s.score?.vacancyScore;
                  const vClass = v == null ? '' : v >= 65 ? 'badge-green' : v >= 40 ? 'badge-amber' : 'badge-red';
                  return (
                    <button
                      key={s.siteId}
                      type="button"
                      className="rd-portfolio-tile"
                      onClick={() => navigate(`/sites/${s.siteId}/report`)}
                      title={`Open report for ${s.address}`}
                    >
                      <img
                        src={mapStaticUrl(s.lat, s.lng, { size: '300x140', zoom: 17 })}
                        alt={`Map of ${s.address}`}
                        loading="lazy"
                      />
                      <div className="rd-portfolio-body">
                        <div className="rd-portfolio-addr">{s.street} {s.houseNumber}</div>
                        <div className="rd-portfolio-meta">
                          <span className="mono">{s.postcode}</span>
                          <span>·</span>
                          <span>{s.areaSqm}m²</span>
                        </div>
                        <div className="rd-portfolio-row">
                          {v != null && (
                            <span className={`badge ${vClass}`}>Vacancy {v}</span>
                          )}
                          <span className="badge badge-muted">{s.scanId}</span>
                        </div>
                      </div>
                    </button>
                  );
                })}
            </div>
            {portfolio.sites.length > 7 && (
              <div className="rd-portfolio-more">
                + {portfolio.sites.length - 7} more sites linked to this owner
              </div>
            )}
          </Card>
        )}

        {/* ── 9. Parking Conversion Details ──────────────────────────── */}
        {conversion && (
          <Card title="Parking Conversion Details" icon={<TrendingUp size={12} />}>
            <div className="rd-conv-hero">
              <div className="rd-conv-metric">
                <div className="rd-conv-num accent">{conversion.spacesEst}</div>
                <div className="rd-conv-label">Estimated bays</div>
              </div>
              <div className="rd-conv-divider" />
              <div className="rd-conv-metric">
                <div className="rd-conv-num green">{formatEur(conversion.revenueBase)}</div>
                <div className="rd-conv-label">Monthly revenue (base)</div>
              </div>
              <div className="rd-conv-divider" />
              <div className="rd-conv-metric">
                <div className="rd-conv-num amber">{formatEur(conversion.setupCostBase || conversion.setupCostHigh)}</div>
                <div className="rd-conv-label">Setup cost (base)</div>
              </div>
              <div className="rd-conv-divider" />
              <div className="rd-conv-metric">
                <div className="rd-conv-num">{roiMonthsLabel}</div>
                <div className="rd-conv-label">Payback</div>
              </div>
            </div>

            {/* Revenue range bars */}
            <div className="rd-rev-chart">
              <div className="rd-rev-title">Monthly revenue range</div>
              {[
                { label: 'Low', value: conversion.revenueLow, color: 'var(--red)' },
                { label: 'Base', value: conversion.revenueBase, color: 'var(--amber)' },
                { label: 'High', value: conversion.revenueHigh, color: 'var(--green)' },
              ].map((bar) => {
                const pct = Math.round((bar.value / conversion.revenueHigh) * 100);
                return (
                  <div key={bar.label} className="rd-rev-row">
                    <div className="rd-rev-label">{bar.label}</div>
                    <div className="rd-rev-track">
                      <div className="rd-rev-fill" style={{ width: `${pct}%`, background: bar.color }} />
                    </div>
                    <div className="rd-rev-value" style={{ color: bar.color }}>{formatEur(bar.value)}</div>
                  </div>
                );
              })}
            </div>

            <div className="rd-grid rd-grid-3" style={{ marginTop: 14 }}>
              <Field label="Revenue Low"  value={`${formatEur(conversion.revenueLow)}/mo`} />
              <Field label="Revenue Base" value={`${formatEur(conversion.revenueBase)}/mo`} />
              <Field label="Revenue High" value={`${formatEur(conversion.revenueHigh)}/mo`} />
              <Field label="Net Revenue Base" value={`${formatEur(conversion.netRevenueMonthly)}/mo`} />
              <Field label="Annual Net Revenue" value={formatEur(conversion.annualNetRevenue)} />
              <Field label="Annual ROI" value={formatPct(conversion.annualRoiPct)} />
              <Field label="Setup Cost Low"  value={formatEur(conversion.setupCostLow)} />
              <Field label="Setup Cost Base" value={formatEur(conversion.setupCostBase || conversion.setupCostHigh)} />
              <Field label="Setup Cost High" value={formatEur(conversion.setupCostHigh)} />
              <Field label="Floor Area → Bays" value={`${site?.areaSqm} m² → ~${conversion.spacesEst} bays @ ${conversion.sqmPerSpace ?? '~30'} m²/bay`} />
              <Field label="Usable Area" value={`${conversion.usableAreaSqm ?? '—'} m² (${conversion.layoutEfficiency ? Math.round(conversion.layoutEfficiency * 100) : '—'}%)`} />
              <Field label="Activation" value={`${conversion.activationDaysLow}-${conversion.activationDaysHigh} days`} />
            </div>
            {conversion.assumptions?.length > 0 && (
              <div className="rd-assumptions">
                <div className="rd-assumptions-title">Model assumptions</div>
                {conversion.assumptions.map((assumption) => (
                  <div key={assumption} className="rd-assumption">• {assumption}</div>
                ))}
              </div>
            )}
          </Card>
        )}

        {/* ── 10. Owner Outreach Draft ───────────────────────────────── */}
        <Card title="Owner Outreach Draft" icon={<Mail size={12} />}>
          {owner && outreach && (
            <div className="rd-outreach-meta">
              <Field label="To" value={<strong>{owner.ownerName}</strong>} />
              <Field label="Delivery" value={outreach.deliveryTo || 'Not configured'} mono />
              <Field label="State" value={<span className={`badge ${outreachBadge(outreach.status)}`}>{outreachLabel(outreach.status)}</span>} />
              {outreach.sentAt && <Field label="Sent At" value={new Date(outreach.sentAt).toLocaleString('nl-NL')} />}
              {outreach.lastError && <Field label="Last Error" value={outreach.lastError} />}
            </div>
          )}
          {printMode ? (
            <pre className="rd-email-print">{emailDraft || '(no draft generated yet)'}</pre>
          ) : (
            <>
              <input
                className="input rd-subject-input"
                value={emailSubject}
                onChange={(e) => setEmailSubject(e.target.value)}
                placeholder="Email subject"
                disabled={sent}
              />
              <textarea
                className="rd-email-editor"
                value={emailDraft}
                onChange={e => setEmailDraft(e.target.value)}
                rows={16}
                disabled={sent}
              />
              <div className="rd-outreach-actions">
                <button className="btn btn-ghost btn-sm" onClick={handleCopy}>
                  {copied ? <><Check size={12} /> Copied</> : <><Copy size={12} /> Copy</>}
                </button>
                <button className="btn btn-secondary btn-sm" onClick={handleSaveDraft} disabled={saving || sent}>
                  {saving ? <><span className="spinner" /> Saving...</> : 'Save Draft'}
                </button>
                {allowApprove && !sent && (
                  <button className="btn btn-primary btn-sm" onClick={handleSendEmail} disabled={sending || !emailDraft || !emailSubject}>
                    {sending ? <><span className="spinner" /> Sending...</> : <><Send size={12} /> Approve & Send to Test Inbox</>}
                  </button>
                )}
                {allowRetry && !sent && (
                  <button className="btn btn-secondary btn-sm" onClick={handleRetry} disabled={sending}>
                    <RotateCcw size={12} /> Retry Automation
                  </button>
                )}
                {allowSkip && !sent && (
                  <button className="btn btn-ghost btn-sm" onClick={handleSkip} disabled={sending}>
                    <Ban size={12} /> Skip
                  </button>
                )}
                {sent && (
                  <span className="badge badge-green"><CheckCircle size={11} /> Sent</span>
                )}
              </div>

              {/* ── Reply simulation (Feature 9) — appears once outreach has
                   actually been sent. Operator picks the outcome to drive the
                   pipeline forward. Stand-in for Phase 2's IMAP poller. ─── */}
              {!printMode && allowSimulateReply && (
                <div className="rd-reply-sim">
                  <div className="rd-reply-sim-header">
                    <Mail size={12} />
                    <span>Simulate owner reply</span>
                    {outreach?.replyOutcome && (
                      <span className={`badge ${outreachBadge(outreach.status)}`} style={{ marginLeft: 'auto' }}>
                        {outreachLabel(outreach.status)}
                      </span>
                    )}
                  </div>
                  <div className="rd-reply-sim-hint">
                    Phase 2 will poll IMAP for replies; for the demo, mark the outcome here
                    so the funnel and CRM pipeline reflect what the owner said.
                  </div>
                  <div className="rd-reply-sim-buttons">
                    <button
                      className={`btn btn-sm rd-reply-btn rd-reply-btn-yes${outreach?.replyOutcome === 'interested' ? ' active' : ''}`}
                      onClick={() => handleSimulateReply('interested')}
                      disabled={sending}
                    >
                      <ThumbsUp size={12} /> Interested
                    </button>
                    <button
                      className={`btn btn-sm rd-reply-btn rd-reply-btn-no${outreach?.replyOutcome === 'not_interested' ? ' active' : ''}`}
                      onClick={() => handleSimulateReply('not_interested')}
                      disabled={sending}
                    >
                      <ThumbsDown size={12} /> Not interested
                    </button>
                    <button
                      className={`btn btn-sm rd-reply-btn rd-reply-btn-none${outreach?.replyOutcome === 'no_reply' ? ' active' : ''}`}
                      onClick={() => handleSimulateReply('no_reply')}
                      disabled={sending}
                    >
                      <Clock4 size={12} /> No reply
                    </button>
                  </div>
                  {outreach?.repliedAt && (
                    <div className="rd-reply-sim-timestamp">
                      Logged {new Date(outreach.repliedAt).toLocaleString('nl-NL')}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </Card>

        {/* ── 10. CRM Pipeline ───────────────────────────────────────── */}
        <Card title="CRM Pipeline">
          <div className="rd-crm">
            {CRM_STAGES.map((stage, i) => {
              const done = i <= currentStageIdx;
              const current = i === currentStageIdx;
              return (
                <div key={stage.key} className={`rd-crm-step${done ? ' done' : ''}${current ? ' current' : ''}`}>
                  <div className="rd-crm-dot">
                    {done ? <CheckCircle size={14} /> : <span className="rd-crm-dot-empty" />}
                  </div>
                  <div className="rd-crm-label">{stage.label}</div>
                  {i < CRM_STAGES.length - 1 && <div className="rd-crm-line" />}
                </div>
              );
            })}
          </div>
        </Card>

        {/* ── 11. Metadata ───────────────────────────────────────────── */}
        <Card title="Report Metadata">
          <div className="rd-grid rd-grid-2">
            <Field label="Generated" value={generated} />
            <Field label="Site ID" value={<span className="mono">{id}</span>} />
            <Field label="Scoring model" value={<span className="mono">v{score?.modelVersion}</span>} />
            <Field label="Scan ID" value={<span className="mono">{site?.scanId}</span>} />
          </div>
          <div className="rd-sources">
            <span className="badge badge-blue">PDOK BAG</span>{' '}
            <span className="badge badge-muted">Kadaster (illustrative)</span>{' '}
            <span className="badge badge-blue">Google Maps Static</span>{' '}
            <span className="badge badge-blue">Street View Static</span>{' '}
            <span className="badge badge-blue">Places API (New)</span>{' '}
            <span className={`badge ${llmBadgeClass}`}>{llmSourceLabel}</span>{' '}
            <span className={`badge ${visionBadgeClass}`}>{visionSourceLabel}</span>
          </div>
        </Card>

      </article>
    </div>
  );
}

/* ── Small reusable presentational helpers ──────────────────────────── */

function Card({ title, icon, children }) {
  return (
    <section className="rd-card">
      <div className="rd-card-title">
        {icon}
        <span>{title}</span>
      </div>
      <div className="rd-card-body">{children}</div>
    </section>
  );
}

function Metric({ label, value, tone }) {
  return (
    <div className="rd-metric">
      <div className={`rd-metric-value${tone ? ` ${tone}` : ''}`}>{value ?? '—'}</div>
      <div className="rd-metric-label">{label}</div>
    </div>
  );
}

function Field({ label, value, mono }) {
  return (
    <div className="rd-field">
      <div className="rd-field-label">{label}</div>
      <div className={`rd-field-value${mono ? ' mono' : ''}`}>{value ?? '—'}</div>
    </div>
  );
}

function formatMonths(months) {
  if (!months) return '—';
  return months < 12 ? `${months} mo` : `${(months / 12).toFixed(1)} yrs`;
}

function formatPct(value) {
  if (value == null) return '—';
  return `${value}%`;
}

function ContextRow({ icon, label, value, positive }) {
  return (
    <div className="rd-ctx-row">
      <span className={`rd-ctx-icon${positive ? ' is-positive' : ''}`}>{icon}</span>
      <div className="rd-ctx-body">
        <div className="rd-ctx-label">{label}</div>
        <div className={`rd-ctx-value${positive ? ' is-positive' : ''}`}>{value}</div>
      </div>
    </div>
  );
}
