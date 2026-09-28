export function scoreColor(score) {
  if (score >= 65) return 'var(--green)';
  if (score >= 40) return 'var(--amber)';
  return 'var(--red)';
}

export function scoreClass(score) {
  if (score >= 65) return 'score-high';
  if (score >= 40) return 'score-med';
  return 'score-low';
}

export function scoreBadge(score) {
  if (score >= 65) return 'badge-green';
  if (score >= 40) return 'badge-amber';
  return 'badge-red';
}

export function scoreLabel(score) {
  if (score >= 65) return 'High';
  if (score >= 40) return 'Medium';
  return 'Low';
}

export function confidenceBadge(c) {
  if (c === 'high') return 'badge-green';
  if (c === 'medium') return 'badge-amber';
  return 'badge-red';
}

export function statusBadge(status) {
  const map = {
    identified: 'badge-muted',
    enriched: 'badge-blue',
    scored: 'badge-blue',
    owner_found: 'badge-amber',
    report_ready: 'badge-green',
    contacted: 'badge-orange',
    negotiating: 'badge-amber',
  };
  return map[status] || 'badge-muted';
}

export function statusLabel(status) {
  const map = {
    identified: 'Identified',
    enriched: 'Enriched',
    scored: 'Scored',
    owner_found: 'Owner Found',
    report_ready: 'Report Ready',
    contacted: 'Contacted',
    negotiating: 'Negotiating',
  };
  return map[status] || status;
}

export function formatEur(n) {
  return `€${Number(n).toLocaleString('nl-NL')}`;
}

export function outreachBadge(status) {
  const map = {
    queued: 'badge-blue',
    processing_owner: 'badge-blue',
    processing_draft: 'badge-blue',
    awaiting_approval: 'badge-amber',
    approved: 'badge-amber',
    sending: 'badge-blue',
    sent: 'badge-green',
    failed: 'badge-red',
    skipped: 'badge-muted',
    replied_interested: 'badge-green',
    replied_not_interested: 'badge-red',
    no_reply: 'badge-muted',
  };
  return map[status] || 'badge-muted';
}

export function outreachLabel(status) {
  const map = {
    queued: 'Queued',
    processing_owner: 'Finding Owner',
    processing_draft: 'Drafting',
    awaiting_approval: 'Awaiting Approval',
    approved: 'Approved',
    sending: 'Sending',
    sent: 'Sent',
    failed: 'Failed',
    skipped: 'Skipped',
    replied_interested: 'Replied · Interested',
    replied_not_interested: 'Replied · Not Interested',
    no_reply: 'No Reply',
  };
  return map[status] || status || 'Not queued';
}

export function canApproveOutreach(outreach) {
  return ['awaiting_approval', 'approved', 'failed'].includes(outreach?.status);
}

export function canRetryOutreach(outreach) {
  return outreach?.status === 'failed';
}

export function canSkipOutreach(outreach) {
  if (!outreach) return false;
  const blocked = ['sent', 'replied_interested', 'replied_not_interested', 'no_reply'];
  return !blocked.includes(outreach.status);
}

// Reply simulation is allowed once outreach is sent, OR when a reply has
// already been simulated (so the operator can flip e.g. no_reply → interested).
export function canSimulateReply(outreach) {
  if (!outreach) return false;
  return ['sent', 'replied_interested', 'replied_not_interested', 'no_reply'].includes(
    outreach.status,
  );
}
