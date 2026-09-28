import { useState, useEffect } from 'react';
import {
  BarChart2, Building2, Zap, FileText, Send, TrendingUp, RefreshCw,
  ThumbsUp, ThumbsDown, Clock4,
} from 'lucide-react';
import { api } from '../lib/api';
import './StatsPage.css';

export default function StatsPage() {
  const [stats, setStats] = useState(null);
  const [sites, setSites] = useState([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const [s, sitesData] = await Promise.all([api.getStats(), api.getSites()]);
      setStats(s);
      setSites(sitesData.sites);
    } finally {
      setLoading(false);
    }
  }

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, []);

  // Distribution data for bar charts
  const scoreBuckets = [
    { label: '0–19', min: 0, max: 20 },
    { label: '20–39', min: 20, max: 40 },
    { label: '40–54', min: 40, max: 55 },
    { label: '55–64', min: 55, max: 65 },
    { label: '65–79', min: 65, max: 80 },
    { label: '80–100', min: 80, max: 101 },
  ];

  const scoredSites = sites.filter(s => s.score);
  const bucketCounts = scoreBuckets.map(b =>
    scoredSites.filter(s => s.score.vacancyScore >= b.min && s.score.vacancyScore < b.max).length
  );
  const maxBucket = Math.max(...bucketCounts, 1);

  const purposeCounts = {};
  sites.forEach(s => {
    const k = s.usePurpose;
    purposeCounts[k] = (purposeCounts[k] || 0) + 1;
  });
  const topPurposes = Object.entries(purposeCounts).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const maxPurpose = Math.max(...topPurposes.map(([, v]) => v), 1);

  const USE_SHORT = {
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

  return (
    <div className="stats-page">
      <div className="stats-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div className="stats-header-icon"><BarChart2 size={18} /></div>
          <div>
            <h1>Dashboard</h1>
            <p>Phase 1 pipeline overview</p>
          </div>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={load}>
          <RefreshCw size={13} />
        </button>
      </div>

      {loading ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 80, gap: 12, color: 'var(--text-muted)' }}>
          <span className="spinner" style={{ width: 24, height: 24 }} /> Loading...
        </div>
      ) : (
        <div className="stats-body fade-in">
          {/* KPI row */}
          <div className="kpi-grid">
            <KPICard icon={<Building2 size={16} />} label="Total Sites" value={stats?.totalSites ?? 0} color="var(--accent-2)" />
            <KPICard icon={<Zap size={16} />} label="Scored" value={stats?.totalScanned ?? 0} color="var(--amber)" sub={`of ${stats?.totalSites ?? 0}`} />
            <KPICard icon={<TrendingUp size={16} />} label="High Vacancy" value={stats?.highVacancy ?? 0} color="var(--green)" sub="score ≥ 65" />
            <KPICard icon={<Building2 size={16} />} label="Parking Spaces" value={formatNumber(stats?.totalParkingSpaces)} color="var(--accent-2)" sub="estimated capacity" />
            <KPICard icon={<TrendingUp size={16} />} label="Monthly Gross" value={formatCompactEur(stats?.monthlyRevenue)} color="var(--green)" />
            <KPICard icon={<TrendingUp size={16} />} label="Annual Net" value={formatCompactEur(stats?.annualNetRevenue)} color="var(--green)" />
            <KPICard icon={<TrendingUp size={16} />} label="Avg ROI" value={formatPct(stats?.avgRoiPct)} color="var(--amber)" sub="annualized" />
            <KPICard icon={<Clock4 size={16} />} label="Avg Payback" value={formatMonths(stats?.avgPaybackMonths)} color="var(--accent)" />
            <KPICard icon={<FileText size={16} />} label="Queue Active" value={stats?.queued ?? 0} color="var(--accent)" />
            <KPICard icon={<FileText size={16} />} label="Awaiting Approval" value={stats?.awaitingApproval ?? 0} color="var(--amber)" />
            <KPICard icon={<FileText size={16} />} label="Failed" value={stats?.failed ?? 0} color="var(--red)" />
            <KPICard icon={<FileText size={16} />} label="Reports Ready" value={stats?.reportsReady ?? 0} color="var(--orange)" />
            <KPICard icon={<Send size={16} />} label="Contacted" value={stats?.contacted ?? 0} color="var(--green)" />
            <KPICard icon={<Send size={16} />} label="Sent" value={stats?.sent ?? 0} color="var(--green)" />
            <KPICard icon={<ThumbsUp size={16} />} label="Replied · Interested" value={stats?.repliedInterested ?? 0} color="var(--green)" />
            <KPICard icon={<ThumbsDown size={16} />} label="Replied · Not Interested" value={stats?.repliedNotInterested ?? 0} color="var(--red)" />
            <KPICard icon={<Clock4 size={16} />} label="No Reply" value={stats?.noReply ?? 0} color="var(--text-muted)" />
          </div>

          <div className="chart-card parking-summary-card">
            <div>
              <div className="chart-title">Parking Opportunity</div>
              <div className="parking-summary-copy">
                Across scored properties, ParkScan estimates <strong>{formatNumber(stats?.totalParkingSpaces)} parking spaces</strong>,
                {' '}<strong>{formatCompactEur(stats?.monthlyNetRevenue)}</strong> monthly net revenue, and
                {' '}<strong>{formatCompactEur(stats?.setupCost)}</strong> total setup cost.
              </div>
            </div>
            <div className="parking-summary-grid">
              <SummaryMetric label="Monthly net" value={formatCompactEur(stats?.monthlyNetRevenue)} />
              <SummaryMetric label="Annual net" value={formatCompactEur(stats?.annualNetRevenue)} />
              <SummaryMetric label="Avg payback" value={formatMonths(stats?.avgPaybackMonths)} />
              <SummaryMetric label="Avg ROI" value={formatPct(stats?.avgRoiPct)} />
            </div>
          </div>

          <div className="charts-row">
            {/* Vacancy score distribution */}
            <div className="chart-card">
              <div className="chart-title">Vacancy Score Distribution</div>
              <div className="bar-chart">
                {scoreBuckets.map((b, i) => (
                  <div key={b.label} className="bar-col">
                    <div className="bar-track">
                      <div
                        className="bar-fill"
                        style={{
                          height: `${(bucketCounts[i] / maxBucket) * 100}%`,
                          background: i >= 4 ? 'var(--green)' : i >= 2 ? 'var(--amber)' : 'var(--red)',
                          opacity: 0.85,
                        }}
                      />
                    </div>
                    <div className="bar-count">{bucketCounts[i]}</div>
                    <div className="bar-label">{b.label}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Use purpose breakdown */}
            <div className="chart-card">
              <div className="chart-title">Use Purpose Breakdown</div>
              <div className="hbar-chart">
                {topPurposes.map(([purpose, count]) => (
                  <div key={purpose} className="hbar-row">
                    <div className="hbar-label">{USE_SHORT[purpose] || purpose}</div>
                    <div className="hbar-track">
                      <div
                        className="hbar-fill"
                        style={{ width: `${(count / maxPurpose) * 100}%` }}
                      />
                    </div>
                    <div className="hbar-count">{count}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Pipeline funnel */}
          <div className="chart-card funnel-card">
            <div className="chart-title">Pipeline Funnel</div>
            <div className="funnel">
              {[
                { label: 'Identified', count: stats?.totalSites ?? 0, color: 'var(--accent)' },
                { label: 'Scored', count: stats?.totalScanned ?? 0, color: 'var(--amber)' },
                { label: 'High Vacancy', count: stats?.highVacancy ?? 0, color: 'var(--orange)' },
                { label: 'Owner Found', count: stats?.ownersFound ?? 0, color: 'var(--orange)' },
                { label: 'Reports Ready', count: stats?.reportsReady ?? 0, color: 'var(--green)' },
                { label: 'Contacted', count: stats?.contacted ?? 0, color: 'var(--green)' },
                { label: 'Replied · Interested', count: stats?.repliedInterested ?? 0, color: 'var(--green)' },
              ].map((step, i, arr) => {
                const pct = arr[0].count > 0 ? Math.round((step.count / arr[0].count) * 100) : 0;
                return (
                  <div key={step.label} className="funnel-step">
                    <div className="funnel-bar-wrap">
                      <div
                        className="funnel-bar"
                        style={{
                          width: `${Math.max(pct, 4)}%`,
                          background: step.color,
                          opacity: 0.8,
                        }}
                      />
                    </div>
                    <div className="funnel-label">{step.label}</div>
                    <div className="funnel-count" style={{ color: step.color }}>
                      {step.count}
                      {i > 0 && <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}> ({pct}%)</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Top investment candidates */}
          {stats?.topConversionCandidates?.length > 0 && (
            <div className="chart-card">
              <div className="chart-title">Top 5 Parking Investment Candidates</div>
              <table className="top-sites-table">
                <thead>
                  <tr>
                    <th>Address</th>
                    <th>Vacancy</th>
                    <th>Parking</th>
                    <th>Spaces</th>
                    <th>Annual Net</th>
                    <th>Payback</th>
                    <th>ROI</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.topConversionCandidates.map(site => (
                      <tr key={site.siteId}>
                        <td style={{ color: 'var(--text-primary)', fontWeight: 500 }}>
                          {site.street} {site.houseNumber}, {site.postcode}
                        </td>
                        <td>
                          <span style={{ fontFamily: 'var(--mono)', fontWeight: 700, fontSize: 14, color: site.vacancyScore >= 65 ? 'var(--green)' : site.vacancyScore >= 40 ? 'var(--amber)' : 'var(--red)' }}>
                            {site.vacancyScore}
                          </span>
                        </td>
                        <td>
                          <span style={{ fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--text-secondary)' }}>
                            {site.parkingScore}
                          </span>
                        </td>
                        <td style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--text-secondary)' }}>{site.spacesEst}</td>
                        <td style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--green)' }}>{formatCompactEur(site.annualNetRevenue)}</td>
                        <td style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--text-secondary)' }}>{formatMonths(site.roiMonths)}</td>
                        <td style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--amber)' }}>{formatPct(site.annualRoiPct)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function KPICard({ icon, label, value, color, sub }) {
  return (
    <div className="kpi-card card">
      <div className="kpi-icon" style={{ color }}>{icon}</div>
      <div className="kpi-value" style={{ color }}>{value}</div>
      <div className="kpi-label">{label}</div>
      {sub && <div className="kpi-sub">{sub}</div>}
    </div>
  );
}

function SummaryMetric({ label, value }) {
  return (
    <div className="summary-metric">
      <div className="summary-metric-value">{value}</div>
      <div className="summary-metric-label">{label}</div>
    </div>
  );
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString('nl-NL');
}

function formatCompactEur(value) {
  const n = Number(value || 0);
  if (Math.abs(n) >= 1000000) return `€${(n / 1000000).toFixed(1)}M`;
  if (Math.abs(n) >= 1000) return `€${Math.round(n / 1000)}k`;
  return `€${n.toLocaleString('nl-NL')}`;
}

function formatPct(value) {
  if (value == null) return '—';
  return `${value}%`;
}

function formatMonths(months) {
  if (!months) return '—';
  return months < 12 ? `${months} mo` : `${(months / 12).toFixed(1)} yrs`;
}
