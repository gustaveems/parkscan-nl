const BASE = '/api';

async function req(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'Request failed');
  }
  return res.json();
}

export const api = {
  getCities: () => req('/cities'),
  getScans: () => req('/scans'),
  createScan: function (payload, maybeDistrict) {
    // Backwards compat: createScan(city, district) still works.
    const body =
      typeof payload === 'string'
        ? { city: payload, district: maybeDistrict ?? null }
        : payload;
    return req('/scans', { method: 'POST', body: JSON.stringify(body) });
  },
  previewScan: (payload) =>
    req('/scans/preview', { method: 'POST', body: JSON.stringify(payload) }),
  getSites: (scanId) => req(`/sites${scanId ? `?scanId=${scanId}` : ''}`),
  getSite: (id) => req(`/sites/${id}`),
  enrichSite: (id) => req(`/sites/${id}/enrich`, { method: 'POST' }),
  scoreSite: (id) => req(`/sites/${id}/score`, { method: 'POST' }),
  scoreAll: (scanId) => req(`/scans/${scanId}/score-all`, { method: 'POST' }),
  lookupOwnership: (id) => req(`/sites/${id}/ownership`, { method: 'POST' }),
  getOwnerPortfolio: (name) =>
    req(`/owners/portfolio?name=${encodeURIComponent(name)}`),
  getReport: (id) => req(`/sites/${id}/report`),
  getOutreach: (scanId, status) =>
    req(`/outreach${[
      scanId ? `scanId=${encodeURIComponent(scanId)}` : '',
      status && status !== 'all' ? `status=${encodeURIComponent(status)}` : '',
    ].filter(Boolean).length ? `?${[
      scanId ? `scanId=${encodeURIComponent(scanId)}` : '',
      status && status !== 'all' ? `status=${encodeURIComponent(status)}` : '',
    ].filter(Boolean).join('&')}` : ''}`),
  queueScanOutreach: (scanId) => req(`/scans/${scanId}/outreach`, { method: 'POST' }),
  approveOutreachSend: (siteId) => req(`/outreach/${siteId}/approve-send`, { method: 'POST' }),
  skipOutreach: (siteId) => req(`/outreach/${siteId}/skip`, { method: 'POST' }),
  retryOutreach: (siteId) => req(`/outreach/${siteId}/retry`, { method: 'POST' }),
  simulateReply: (siteId, outcome) =>
    req(`/outreach/${siteId}/simulate-reply`, {
      method: 'POST',
      body: JSON.stringify({ outcome }),
    }),
  updateOutreach: (id, data) =>
    req(`/sites/${id}/outreach`, { method: 'PATCH', body: JSON.stringify(data) }),
  getStats: () => req('/stats'),
};
