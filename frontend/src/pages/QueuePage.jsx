import { useState, useEffect, useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import {
  Search, ChevronRight, Zap, RefreshCw, Building2, MapPin, Filter,
  Mail, Send, RotateCcw, Ban, CheckCircle
} from 'lucide-react';
import { api } from '../lib/api';
import {
  scoreClass, scoreBadge, statusBadge, statusLabel, scoreLabel,
  outreachBadge, outreachLabel, canApproveOutreach, canRetryOutreach, canSkipOutreach,
} from '../lib/utils';
import './QueuePage.css';

const USE_LABELS = {
  kantoorfunctie: 'Office',
  winkelfunctie: 'Retail',
  industriefunctie: 'Industrial',
  celfunctie: 'Cell / Storage',
  gezondheidszorgfunctie: 'Healthcare',
  logiesfunctie: 'Lodging',
  onderwijsfunctie: 'Education',
  sportfunctie: 'Sport',
  'overige gebruiksfunctie': 'Other',
  woonfunctie: 'Residential',
};

const OUTREACH_FILTERS = ['all', 'awaiting_approval', 'failed', 'sent', 'skipped'];

export default function QueuePage() {
  const [searchParams] = useSearchParams();
  const scanId = searchParams.get('scanId');
  const navigate = useNavigate();

  const [sites, setSites] = useState([]);
  const [scans, setScans] = useState([]);
  const [outreachItems, setOutreachItems] = useState([]);
  const [outreachMeta, setOutreachMeta] = useState(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterScore, setFilterScore] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [sortBy, setSortBy] = useState('vacancy');
  const [selected, setSelected] = useState(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);
  const [activeScan, setActiveScan] = useState(scanId || '');
  const [view, setView] = useState('candidates');
  const [outreachStatus, setOutreachStatus] = useState('all');
  const [actionLoading, setActionLoading] = useState('');
  const [queueing, setQueueing] = useState(false);
  const [loadError, setLoadError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [sitesData, scansData] = await Promise.all([
        api.getSites(activeScan || undefined),
        api.getScans(),
      ]);
      setSites(sitesData.sites ?? []);
      setScans(scansData.scans ?? []);
      try {
        const outreachData = await api.getOutreach(activeScan || undefined, outreachStatus);
        setOutreachItems(outreachData.items ?? []);
        setOutreachMeta(outreachData.meta ?? null);
      } catch (err) {
        console.warn("[queue] outreach load failed:", err);
        setOutreachItems([]);
        setOutreachMeta(null);
        setLoadError("Outreach queue could not load; the site list below is still valid.");
      }
    } catch (err) {
      console.error("[queue] load failed:", err);
      setSites([]);
      setScans([]);
      setOutreachItems([]);
      setOutreachMeta(null);
      setLoadError(err instanceof Error ? err.message : "Failed to load queue. Is the backend running on :3001?");
    } finally {
      setLoading(false);
    }
  }, [activeScan, outreachStatus]);

  useEffect(() => { load(); }, [load]);

  // Deep-link: /queue?scanId=… pre-selects that scan in the dropdown
  useEffect(() => {
    const id = searchParams.get("scanId");
    if (id) setActiveScan(id);
  }, [searchParams]);

  const filteredSites = sites
    .filter((s) => {
      const addr = (s.address || "").toLowerCase();
      if (search && !addr.includes(search.toLowerCase())) return false;
      if (filterScore === 'high' && (s.score?.vacancyScore ?? 0) < 65) return false;
      if (filterScore === 'med' && ((s.score?.vacancyScore ?? 0) < 40 || (s.score?.vacancyScore ?? 0) >= 65)) return false;
      if (filterScore === 'low' && (s.score?.vacancyScore ?? 0) >= 40) return false;
      if (filterStatus !== 'all' && s.status !== filterStatus) return false;
      return true;
    })
    .sort((a, b) => {
      if (sortBy === 'vacancy') return (b.score?.vacancyScore ?? -1) - (a.score?.vacancyScore ?? -1);
      if (sortBy === 'parking') return (b.score?.parkingScore ?? -1) - (a.score?.parkingScore ?? -1);
      if (sortBy === 'area') return (b.areaSqm ?? 0) - (a.areaSqm ?? 0);
      if (sortBy === 'year') return (a.buildYear ?? 9999) - (b.buildYear ?? 9999);
      return 0;
    });

  async function handleBulkOwnership() {
    const ids = [...selected].filter((id) => {
      const site = sites.find((x) => x.id === id);
      return site && !site.hasOwner && site.score && site.score.vacancyScore >= 40;
    });
    if (!ids.length) return;
    setBulkLoading(true);
    try {
      await Promise.all(ids.map((id) => api.lookupOwnership(id)));
      await load();
      setSelected(new Set());
    } finally {
      setBulkLoading(false);
    }
  }

  async function handleManualQueue() {
    if (!activeScan) return;
    setQueueing(true);
    try {
      await api.queueScanOutreach(activeScan);
      setView('outreach');
      await load();
    } finally {
      setQueueing(false);
    }
  }

  async function runOutreachAction(siteId, action) {
    setActionLoading(siteId);
    try {
      if (action === 'approve') await api.approveOutreachSend(siteId);
      if (action === 'retry') await api.retryOutreach(siteId);
      if (action === 'skip') await api.skipOutreach(siteId);
      await load();
    } finally {
      setActionLoading('');
    }
  }

  function toggleSelect(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  const highCount = sites.filter((s) => (s.score?.vacancyScore ?? 0) >= 65).length;
  const medCount = sites.filter((s) => {
    const value = s.score?.vacancyScore ?? 0;
    return value >= 40 && value < 65;
  }).length;
  const awaitingCount = outreachItems.filter((item) => item.outreach.status === 'awaiting_approval').length;
  const failedCount = outreachItems.filter((item) => item.outreach.status === 'failed').length;
  const policy = outreachMeta?.policy;

  return (
    <div className="queue-page">
      <div className="queue-header">
        <div className="queue-header-left">
          <h1>Site Queue</h1>
          <div className="queue-counts">
            <span className="count-chip chip-total">{sites.length} total</span>
            <span className="count-chip chip-high">{highCount} high</span>
            <span className="count-chip chip-med">{medCount} medium</span>
            <span className="count-chip chip-outreach">{awaitingCount} awaiting approval</span>
          </div>
        </div>
        <div className="queue-header-right">
          <select
            value={activeScan}
            onChange={(e) => setActiveScan(e.target.value)}
            style={{ minWidth: 220 }}
          >
            <option value="">All scans</option>
            {scans.map((scan) => (
              <option key={scan.id} value={scan.id}>
                {scan.city} — {scan.district || scan.areaLabel || 'custom'} ({scan.id})
              </option>
            ))}
          </select>
          {activeScan && (
            <button className="btn btn-secondary btn-sm" onClick={handleManualQueue} disabled={queueing}>
              {queueing ? <><span className="spinner" /> Queueing...</> : <><Mail size={12} /> Refresh Outreach Queue</>}
            </button>
          )}
          <button className="btn btn-ghost btn-sm" onClick={load}>
            <RefreshCw size={13} />
          </button>
        </div>
      </div>

      <div className="queue-view-tabs">
        {[
          { key: 'candidates', label: 'Candidates' },
          { key: 'outreach', label: 'Outreach Queue' },
        ].map((tab) => (
          <button
            key={tab.key}
            className={`queue-view-tab${view === tab.key ? ' active' : ''}`}
            onClick={() => setView(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="queue-toolbar">
        {view === 'candidates' ? (
          <>
            <div className="toolbar-left">
              <div className="search-wrap">
                <Search size={13} className="search-icon" />
                <input
                  placeholder="Search address..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="search-input"
                />
              </div>

              <div className="filter-group">
                <Filter size={12} style={{ color: 'var(--text-muted)' }} />
                <select value={filterScore} onChange={(e) => setFilterScore(e.target.value)}>
                  <option value="all">All scores</option>
                  <option value="high">High vacancy (≥65)</option>
                  <option value="med">Medium (40–64)</option>
                  <option value="low">Low (&lt;40)</option>
                </select>
                <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
                  <option value="all">All statuses</option>
                  <option value="identified">Identified</option>
                  <option value="scored">Scored</option>
                  <option value="owner_found">Owner found</option>
                  <option value="report_ready">Report ready</option>
                  <option value="contacted">Contacted</option>
                  <option value="negotiating">Negotiating</option>
                </select>
              </div>

              <div className="sort-group">
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Sort:</span>
                {[
                  { key: 'vacancy', label: 'Vacancy' },
                  { key: 'parking', label: 'Parking' },
                  { key: 'area', label: 'Area' },
                  { key: 'year', label: 'Year' },
                ].map((opt) => (
                  <button
                    key={opt.key}
                    className={`sort-btn${sortBy === opt.key ? ' active' : ''}`}
                    onClick={() => setSortBy(opt.key)}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {selected.size > 0 && (
              <div className="bulk-actions fade-in">
                <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{selected.size} selected</span>
                <button
                  className="btn btn-primary btn-sm"
                  onClick={handleBulkOwnership}
                  disabled={bulkLoading}
                >
                  {bulkLoading ? <span className="spinner" /> : <Zap size={12} />}
                  Request Ownership ({selected.size})
                </button>
                <button className="btn btn-ghost btn-sm" onClick={() => setSelected(new Set())}>
                  Clear
                </button>
              </div>
            )}
          </>
        ) : (
          <div className="outreach-toolbar">
            <div className="filter-group">
              <Filter size={12} style={{ color: 'var(--text-muted)' }} />
              <select value={outreachStatus} onChange={(e) => setOutreachStatus(e.target.value)}>
                {OUTREACH_FILTERS.map((status) => (
                  <option key={status} value={status}>
                    {status === 'all' ? 'All outreach states' : outreachLabel(status)}
                  </option>
                ))}
              </select>
            </div>
            {policy && (
              <div className="outreach-summary">
                <span>Auto-queue: top {policy.maxSitesPerScan}</span>
                <span>Min score {policy.minVacancyScore}</span>
                <span>Delivery: {policy.deliveryMode === 'internal_inbox' ? 'Internal inbox' : 'Mock'}</span>
                <span>{policy.approvalRequired ? 'Manual approval required' : 'Auto-send'}</span>
                {policy.deliveryTo && <span className="mono">{policy.deliveryTo}</span>}
              </div>
            )}
          </div>
        )}
      </div>

      {loadError && (
        <div className="queue-banner queue-banner--warn" role="status">
          {loadError}
        </div>
      )}

      <div className="queue-table-wrap">
        {loading ? (
          <div className="loading-state">
            <span className="spinner" style={{ width: 24, height: 24 }} />
            <span style={{ color: 'var(--text-muted)' }}>Loading queue...</span>
          </div>
        ) : view === 'candidates' ? (
          filteredSites.length === 0 ? (
            <div className="empty-state">
              <Building2 size={32} style={{ color: 'var(--text-muted)' }} />
              {sites.length === 0 ? (
                <>
                  <div>
                    {activeScan
                      ? "No sites for this scan. The scan may be empty, or the id is stale. Try “All scans” or start a new scan on New Scan."
                      : "No sites in the database yet. Open New Scan, pick a city/area, and run a scan (about 24 sites)."}
                  </div>
                  {!activeScan && (
                    <button type="button" className="btn btn-primary btn-sm" onClick={() => navigate("/")} style={{ marginTop: 12 }}>
                      Go to New Scan
                    </button>
                  )}
                </>
              ) : (
                <>
                  <div>
                    {sites.length} site{sites.length === 1 ? "" : "s"} loaded, but none match your search or filters.
                  </div>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    style={{ marginTop: 12 }}
                    onClick={() => {
                      setSearch("");
                      setFilterScore("all");
                      setFilterStatus("all");
                    }}
                  >
                    Clear search and filters
                  </button>
                </>
              )}
            </div>
          ) : (
            <table className="queue-table">
              <thead>
                <tr>
                  <th style={{ width: 36 }}></th>
                  <th>Address</th>
                  <th style={{ width: 90 }}>Vacancy</th>
                  <th style={{ width: 90 }}>Parking</th>
                  <th>Purpose</th>
                  <th>Area</th>
                  <th>Year</th>
                  <th>Status</th>
                  <th style={{ width: 36 }}></th>
                </tr>
              </thead>
              <tbody>
                {filteredSites.map((site) => (
                  <tr
                    key={site.id}
                    className={`site-row${selected.has(site.id) ? ' selected' : ''}`}
                    onClick={() => navigate(`/sites/${site.id}`)}
                  >
                    <td onClick={(e) => { e.stopPropagation(); toggleSelect(site.id); }}>
                      <input
                        type="checkbox"
                        checked={selected.has(site.id)}
                        onChange={() => {}}
                        className="row-check"
                      />
                    </td>
                    <td>
                      <div className="addr-cell">
                        <MapPin size={11} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                        <div>
                          <div className="addr-main">{site.street} {site.houseNumber}</div>
                          <div className="addr-sub mono">{site.postcode} · {site.city}</div>
                        </div>
                      </div>
                    </td>
                    <td>
                      {site.score ? (
                        <div className="score-cell">
                          <span className={`score-val ${scoreClass(site.score.vacancyScore)}`}>
                            {site.score.vacancyScore}
                          </span>
                          <span className={`badge ${scoreBadge(site.score.vacancyScore)}`}>
                            {scoreLabel(site.score.vacancyScore)}
                          </span>
                        </div>
                      ) : <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>—</span>}
                    </td>
                    <td>
                      {site.score ? (
                        <span className={`score-val ${scoreClass(site.score.parkingScore)}`}>
                          {site.score.parkingScore}
                        </span>
                      ) : <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>—</span>}
                    </td>
                    <td>
                      <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                        {USE_LABELS[site.usePurpose] || site.usePurpose}
                      </span>
                    </td>
                    <td>
                      <span className="mono" style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                        {site.areaSqm}m²
                      </span>
                    </td>
                    <td>
                      <span className="mono" style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                        {site.buildYear}
                      </span>
                    </td>
                    <td>
                      <span className={`badge ${statusBadge(site.status)}`}>
                        {statusLabel(site.status)}
                      </span>
                    </td>
                    <td>
                      <ChevronRight size={14} style={{ color: 'var(--text-muted)' }} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        ) : outreachItems.length === 0 ? (
          <div className="empty-state">
            <Mail size={32} style={{ color: 'var(--text-muted)' }} />
            <div>No outreach items yet.</div>
            <div style={{ fontSize: 12 }}>Score a scan, then queue the top candidates for approval.</div>
          </div>
        ) : (
          <table className="queue-table outreach-table">
            <thead>
              <tr>
                <th>Address</th>
                <th style={{ width: 88 }}>Vacancy</th>
                <th style={{ width: 170 }}>Automation</th>
                <th>Delivery</th>
                <th style={{ width: 180 }}>Last Update</th>
                <th style={{ width: 320 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {outreachItems.map((item) => (
                <tr key={item.site.id} className="site-row" onClick={() => navigate(`/sites/${item.site.id}/report`)}>
                  <td>
                    <div className="addr-cell">
                      <MapPin size={11} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                      <div>
                        <div className="addr-main">{item.site.address}</div>
                        <div className="addr-sub mono">
                          {item.site.scanId} · {item.owner?.ownerName || 'Owner pending'}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <span className={`score-val ${scoreClass(item.score?.vacancyScore ?? 0)}`}>
                      {item.score?.vacancyScore ?? '—'}
                    </span>
                  </td>
                  <td>
                    <div className="outreach-state-cell">
                      <span className={`badge ${outreachBadge(item.outreach.status)}`}>
                        {outreachLabel(item.outreach.status)}
                      </span>
                      {item.outreach.lastError && (
                        <div className="outreach-error-line">{item.outreach.lastError}</div>
                      )}
                    </div>
                  </td>
                  <td>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <span>{item.outreach.deliveryMode === 'internal_inbox' ? 'Internal inbox' : 'Mock'}</span>
                      <span className="mono" style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                        {item.outreach.deliveryTo || '—'}
                      </span>
                    </div>
                  </td>
                  <td>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <span style={{ color: 'var(--text-secondary)' }}>
                        {new Date(item.outreach.updatedAt || item.outreach.createdAt).toLocaleString('nl-NL')}
                      </span>
                      {item.outreach.sentAt && (
                        <span className="mono" style={{ fontSize: 11, color: 'var(--green)' }}>
                          Sent {new Date(item.outreach.sentAt).toLocaleTimeString('nl-NL')}
                        </span>
                      )}
                    </div>
                  </td>
                  <td>
                    <div className="outreach-actions-cell" onClick={(e) => e.stopPropagation()}>
                      <button className="btn btn-ghost btn-sm" onClick={() => navigate(`/sites/${item.site.id}/report`)}>
                        <ChevronRight size={12} /> Open Report
                      </button>
                      {canApproveOutreach(item.outreach) && (
                        <button
                          className="btn btn-primary btn-sm"
                          onClick={() => runOutreachAction(item.site.id, 'approve')}
                          disabled={actionLoading === item.site.id}
                        >
                          {actionLoading === item.site.id ? <span className="spinner" /> : <Send size={12} />}
                          Approve & Send
                        </button>
                      )}
                      {canRetryOutreach(item.outreach) && (
                        <button
                          className="btn btn-secondary btn-sm"
                          onClick={() => runOutreachAction(item.site.id, 'retry')}
                          disabled={actionLoading === item.site.id}
                        >
                          <RotateCcw size={12} /> Retry
                        </button>
                      )}
                      {canSkipOutreach(item.outreach) && item.outreach.status !== 'sent' && (
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={() => runOutreachAction(item.site.id, 'skip')}
                          disabled={actionLoading === item.site.id}
                        >
                          <Ban size={12} /> Skip
                        </button>
                      )}
                      {item.outreach.status === 'sent' && (
                        <span className="badge badge-green"><CheckCircle size={11} /> Sent</span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {view === 'outreach' && failedCount > 0 && (
        <div className="queue-footer-note">
          {failedCount} outreach item{failedCount === 1 ? '' : 's'} failed and can be retried after editing the draft or SMTP config.
        </div>
      )}
    </div>
  );
}
