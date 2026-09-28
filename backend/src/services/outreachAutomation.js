import { getStore } from "../db/index.js";
import { generateOwnership } from "../data/mockData.js";
import { computeConversionModel } from "./scoringEngine.js";
import { generateOutreachEmail } from "./llm.js";
import { getDeliveryConfig, sendOutreachMessage } from "./mailer.js";

export const OUTREACH_ACTIVE_STATUSES = new Set([
  "queued",
  "processing_owner",
  "processing_draft",
  "awaiting_approval",
  "approved",
  "sending",
]);

export const OUTREACH_TERMINAL_STATUSES = new Set([
  "sent",
  "failed",
  "skipped",
  "replied_interested",
  "replied_not_interested",
  "no_reply",
]);

// Statuses we consider "post-send" — i.e. the email has actually gone out and
// is now waiting for (or has resolved into) a reply.
export const OUTREACH_REPLY_STATUSES = new Set([
  "replied_interested",
  "replied_not_interested",
  "no_reply",
]);

export const REPLY_OUTCOMES = {
  interested: "replied_interested",
  not_interested: "replied_not_interested",
  no_reply: "no_reply",
};

let workerTimer = null;
let workerRunning = false;

function boolEnv(v, fallback = true) {
  if (v == null || v === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(v).toLowerCase());
}

export function getAutomationConfig() {
  const delivery = getDeliveryConfig();
  return {
    enabled: boolEnv(process.env.OUTREACH_AUTOMATION_ENABLED, true),
    minVacancyScore: Number(process.env.OUTREACH_MIN_VACANCY_SCORE || 65),
    maxSitesPerScan: Number(process.env.OUTREACH_MAX_SITES_PER_SCAN || 5),
    deliveryMode: delivery.mode,
    deliveryTo: delivery.testTo || "",
    approvalRequired: true,
  };
}

export function qualifiesForOutreach({
  site,
  score,
  outreach,
  minVacancyScore,
}) {
  if (!site || !score) return false;
  if (score.vacancyScore < minVacancyScore) return false;
  if (site.status === "contacted") return false;
  if (!outreach) return true;
  if (OUTREACH_ACTIVE_STATUSES.has(outreach.status)) return false;
  if (OUTREACH_TERMINAL_STATUSES.has(outreach.status)) return false;
  return false;
}

export async function queueEligibleSitesForScan(scanId, store = getStore()) {
  const config = getAutomationConfig();
  if (!config.enabled) return { queued: 0, siteIds: [], policy: config };

  const sites = await store.sites.listByScan(scanId);
  const hydrated = await Promise.all(
    sites.map(async (site) => ({
      site,
      score: await store.scores.get(site.id),
      outreach: await store.outreach.get(site.id),
    })),
  );

  const selected = hydrated
    .filter((item) =>
      qualifiesForOutreach({
        ...item,
        minVacancyScore: config.minVacancyScore,
      }),
    )
    .sort((a, b) => b.score.vacancyScore - a.score.vacancyScore)
    .slice(0, config.maxSitesPerScan);

  const queuedAt = new Date().toISOString();

  await Promise.all(
    selected.map(({ site }) =>
      store.outreach.upsert(site.id, {
        status: "queued",
        queuedAt,
        deliveryMode: config.deliveryMode,
        deliveryTo: config.deliveryTo || null,
        lastError: null,
      }),
    ),
  );

  return {
    queued: selected.length,
    siteIds: selected.map(({ site }) => site.id),
    policy: config,
  };
}

async function ensureOwnerAndConversion(siteId, store) {
  const site = await store.sites.get(siteId);
  if (!site) throw new Error("Site not found");

  const score = await store.scores.get(siteId);
  if (!score) throw new Error("Site score missing");

  let owner = await store.owners.get(siteId);
  if (!owner) {
    await store.outreach.upsert(siteId, {
      status: "processing_owner",
      lastError: null,
    });
    owner = await store.owners.set(siteId, generateOwnership(site));
    await store.sites.update(siteId, { status: "owner_found" });
  }

  let conversion = await store.conversions.get(siteId);
  if (!conversion) {
    conversion = await store.conversions.set(siteId, computeConversionModel(site, score));
  }

  return { site, score, owner, conversion };
}

export async function prepareOutreachForSite(siteId, store = getStore()) {
  const config = getAutomationConfig();
  const current = await store.outreach.get(siteId);
  const attemptCount = (current?.attemptCount ?? 0) + 1;
  const lastAttemptAt = new Date().toISOString();

  try {
    const { site, score, owner, conversion } = await ensureOwnerAndConversion(siteId, store);
    await store.outreach.upsert(siteId, {
      status: "processing_draft",
      attemptCount,
      lastAttemptAt,
      lastError: null,
      deliveryMode: config.deliveryMode,
      deliveryTo: config.deliveryTo || null,
    });

    const { subject, body, provider } = await generateOutreachEmail({
      site,
      score,
      owner,
      conversion,
    });

    const outreach = await store.outreach.upsert(siteId, {
      subject,
      draft: body,
      provider,
      status: "awaiting_approval",
      attemptCount,
      lastAttemptAt,
      lastError: null,
      deliveryMode: config.deliveryMode,
      deliveryTo: config.deliveryTo || null,
    });

    await store.sites.update(siteId, { status: "report_ready" });
    return outreach;
  } catch (err) {
    return store.outreach.upsert(siteId, {
      status: "failed",
      attemptCount,
      lastAttemptAt,
      lastError: err.message,
      deliveryMode: config.deliveryMode,
      deliveryTo: config.deliveryTo || null,
    });
  }
}

export async function processOutreachQueueOnce(store = getStore()) {
  if (workerRunning) return { processed: 0, skipped: true };
  workerRunning = true;

  try {
    const queued = await store.outreach.list({ status: "queued" });
    let processed = 0;
    for (const item of queued) {
      await prepareOutreachForSite(item.siteId, store);
      processed++;
    }
    return { processed, skipped: false };
  } finally {
    workerRunning = false;
  }
}

export function kickOutreachWorker() {
  void processOutreachQueueOnce();
}

export function startOutreachWorker() {
  if (workerTimer || process.env.NODE_ENV === "test") return;
  workerTimer = setInterval(() => {
    void processOutreachQueueOnce();
  }, 1500);
}

export function stopOutreachWorker() {
  if (!workerTimer) return;
  clearInterval(workerTimer);
  workerTimer = null;
}

export async function ensureOutreachDraft(siteId, store = getStore()) {
  const existing = await store.outreach.get(siteId);
  if (existing?.subject && existing?.draft) return existing;
  return prepareOutreachForSite(siteId, store);
}

export async function approveAndSendOutreach(siteId, store = getStore()) {
  const existing = await store.outreach.get(siteId);
  if (!existing) throw new Error("Outreach record not found");
  if (!["awaiting_approval", "approved", "failed"].includes(existing.status)) {
    throw new Error(`Cannot send outreach from status '${existing.status}'`);
  }
  if (!existing.subject || !existing.draft) {
    throw new Error("Outreach draft is incomplete");
  }

  const approvedAt = new Date().toISOString();
  const attemptCount = (existing.attemptCount ?? 0) + 1;
  const lastAttemptAt = new Date().toISOString();

  await store.outreach.upsert(siteId, {
    status: "approved",
    approvedAt,
    attemptCount,
    lastAttemptAt,
    lastError: null,
  });
  await store.outreach.upsert(siteId, {
    status: "sending",
    approvedAt,
    attemptCount,
    lastAttemptAt,
    lastError: null,
  });

  try {
    const result = await sendOutreachMessage({
      subject: existing.subject,
      body: existing.draft,
      requestedTo: existing.deliveryTo || undefined,
    });

    const sentAt = new Date().toISOString();
    const outreach = await store.outreach.upsert(siteId, {
      status: "sent",
      approvedAt,
      sentAt,
      attemptCount,
      lastAttemptAt,
      lastError: null,
      deliveryMode: result.mode,
      deliveryTo: result.deliveryTo,
      messageId: result.messageId,
    });

    await store.sites.update(siteId, {
      status: "contacted",
      contactedAt: sentAt,
    });

    return outreach;
  } catch (err) {
    return store.outreach.upsert(siteId, {
      status: "failed",
      approvedAt,
      attemptCount,
      lastAttemptAt,
      lastError: err.message,
    });
  }
}

export async function retryOutreach(siteId, store = getStore()) {
  const current = await store.outreach.get(siteId);
  if (!current || current.status !== "failed") {
    throw new Error("Only failed outreach items can be retried");
  }
  const queuedAt = new Date().toISOString();
  const updated = await store.outreach.upsert(siteId, {
    status: "queued",
    queuedAt,
    lastError: null,
  });
  kickOutreachWorker();
  return updated;
}

export async function skipOutreach(siteId, store = getStore()) {
  const current = await store.outreach.get(siteId);
  if (!current) throw new Error("Outreach record not found");
  if (current.status === "sent") {
    throw new Error("Sent outreach cannot be skipped");
  }
  if (OUTREACH_REPLY_STATUSES.has(current.status)) {
    throw new Error("Outreach with a recorded reply cannot be skipped");
  }
  return store.outreach.upsert(siteId, {
    status: "skipped",
    lastError: null,
  });
}

export function getOutreachPolicyMeta() {
  const config = getAutomationConfig();
  return {
    minVacancyScore: config.minVacancyScore,
    maxSitesPerScan: config.maxSitesPerScan,
    deliveryMode: config.deliveryMode,
    deliveryTo: config.deliveryTo || null,
    approvalRequired: config.approvalRequired,
  };
}

// ── Reply simulation (Feature 9) ────────────────────────────────────────────
// Phase 2 will wire a real IMAP poller / inbound webhook to update outreach
// status when an owner replies. For the demo, the operator can manually mark
// what the simulated reply was. This is intentionally a one-way transition:
// once an item is in a reply state, you can re-simulate (e.g. switch from
// no_reply to interested) but not un-send.
export async function simulateReply(siteId, outcome, store = getStore()) {
  const mappedStatus = REPLY_OUTCOMES[outcome];
  if (!mappedStatus) {
    throw new Error(
      `Unknown reply outcome '${outcome}'. Expected one of: ${Object.keys(REPLY_OUTCOMES).join(", ")}`,
    );
  }

  const existing = await store.outreach.get(siteId);
  if (!existing) throw new Error("Outreach record not found");

  // Only allow simulating replies on outreach that has actually been "sent"
  // (or already has a previous simulated reply we're now changing).
  const allowed = new Set(["sent", ...OUTREACH_REPLY_STATUSES]);
  if (!allowed.has(existing.status)) {
    throw new Error(
      `Reply simulation only allowed after outreach is sent (current: '${existing.status}')`,
    );
  }

  const repliedAt = new Date().toISOString();
  const updated = await store.outreach.upsert(siteId, {
    status: mappedStatus,
    repliedAt,
    replyOutcome: outcome,
  });

  // Lift the site status to "negotiating" when the simulated reply is positive.
  if (outcome === "interested") {
    await store.sites.update(siteId, { status: "negotiating" });
  }

  return updated;
}
