import test, { afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import nodemailer from "nodemailer";
import { memoryStore } from "../db/memoryStore.js";
import {
  approveAndSendOutreach,
  prepareOutreachForSite,
  qualifiesForOutreach,
  queueEligibleSitesForScan,
  simulateReply,
} from "./outreachAutomation.js";
import { resetMailer, sendOutreachMessage } from "./mailer.js";

function makeSite(id, vacancyScore, status = "scored") {
  return {
    id,
    scanId: "scan-1",
    city: "amsterdam",
    district: "centrum",
    address: `${id} Teststraat 1`,
    street: "Teststraat",
    houseNumber: "1",
    postcode: "1000AA",
    lat: 52.37,
    lng: 4.89,
    bagId: `bag-${id}`,
    parcelRef: `parcel-${id}`,
    buildYear: 1970,
    usePurpose: "kantoorfunctie",
    areaSqm: 700,
    bagStatus: "Pand buiten gebruik",
    status,
    createdAt: new Date().toISOString(),
    score: {
      vacancyScore,
      parkingScore: 70,
      confidence: "high",
      reasons: [],
      modelVersion: "1.0.0",
      scoredAt: new Date().toISOString(),
    },
  };
}

async function seedSites(items) {
  await memoryStore.scans.create({
    id: "scan-1",
    city: "amsterdam",
    district: "centrum",
    status: "complete",
    siteCount: items.length,
    createdAt: new Date().toISOString(),
  });
  await memoryStore.sites.bulkCreate(items.map(({ score, ...site }) => site));
  await Promise.all(items.map(({ id, score }) => memoryStore.scores.set(id, score)));
}

afterEach(() => {
  memoryStore.__reset();
  resetMailer();
  delete process.env.OUTREACH_TEST_TO;
  delete process.env.OUTREACH_DELIVERY_MODE;
  delete process.env.OUTREACH_MIN_VACANCY_SCORE;
  delete process.env.OUTREACH_MAX_SITES_PER_SCAN;
  delete process.env.SMTP_HOST;
  delete process.env.SMTP_PORT;
  delete process.env.SMTP_USER;
  delete process.env.SMTP_PASS;
  delete process.env.SMTP_SECURE;
});

test("queueEligibleSitesForScan honors threshold, cap, and existing outreach", async () => {
  process.env.OUTREACH_MIN_VACANCY_SCORE = "65";
  process.env.OUTREACH_MAX_SITES_PER_SCAN = "2";
  const sites = [
    makeSite("a", 90),
    makeSite("b", 86),
    makeSite("c", 82),
    makeSite("d", 50),
  ];
  await seedSites(sites);
  await memoryStore.outreach.upsert("b", { status: "awaiting_approval" });

  const result = await queueEligibleSitesForScan("scan-1", memoryStore);

  assert.equal(result.queued, 2);
  assert.deepEqual(result.siteIds, ["a", "c"]);
});

test("prepareOutreachForSite transitions queued work to awaiting approval", async () => {
  process.env.OUTREACH_TEST_TO = "internal@example.com";
  await seedSites([makeSite("a", 90)]);
  await memoryStore.outreach.upsert("a", { status: "queued" });

  const outreach = await prepareOutreachForSite("a", memoryStore);

  assert.equal(outreach.status, "awaiting_approval");
  assert.ok(outreach.subject);
  assert.ok(outreach.draft);
  assert.equal((await memoryStore.sites.get("a")).status, "report_ready");
  assert.ok(await memoryStore.owners.get("a"));
  assert.ok(await memoryStore.conversions.get("a"));
});

test("approveAndSendOutreach marks the site contacted when delivery succeeds", async () => {
  process.env.OUTREACH_DELIVERY_MODE = "mock";
  process.env.OUTREACH_TEST_TO = "internal@example.com";
  await seedSites([makeSite("a", 90)]);
  await memoryStore.outreach.upsert("a", {
    status: "awaiting_approval",
    subject: "Subject",
    draft: "Body",
    deliveryTo: "owner@example.com",
  });

  const outreach = await approveAndSendOutreach("a", memoryStore);

  assert.equal(outreach.status, "sent");
  assert.equal(outreach.deliveryTo, "internal@example.com");
  assert.match(outreach.messageId, /^mock-/);
  assert.equal((await memoryStore.sites.get("a")).status, "contacted");
});

test("sendOutreachMessage rewrites internal inbox delivery target", async () => {
  process.env.OUTREACH_DELIVERY_MODE = "internal_inbox";
  process.env.OUTREACH_TEST_TO = "internal@example.com";
  process.env.OUTREACH_FROM_EMAIL = "parkscan@example.com";
  process.env.SMTP_HOST = "smtp.example.com";
  process.env.SMTP_USER = "user";
  process.env.SMTP_PASS = "pass";

  let seenMail = null;
  const createTransportMock = mock.method(nodemailer, "createTransport", () => ({
    sendMail: async (mail) => {
      seenMail = mail;
      return { messageId: "smtp-123" };
    },
  }));

  const result = await sendOutreachMessage({
    subject: "Subject",
    body: "Body",
    requestedTo: "owner@example.com",
  });

  assert.equal(result.deliveryTo, "internal@example.com");
  assert.equal(seenMail.to, "internal@example.com");
  assert.equal(seenMail.subject, "Subject");
  createTransportMock.mock.restore();
});

test("qualifiesForOutreach rejects low-score and already-queued sites", () => {
  const low = qualifiesForOutreach({
    site: { status: "scored" },
    score: { vacancyScore: 40 },
    outreach: null,
    minVacancyScore: 65,
  });
  const queued = qualifiesForOutreach({
    site: { status: "scored" },
    score: { vacancyScore: 90 },
    outreach: { status: "queued" },
    minVacancyScore: 65,
  });

  assert.equal(low, false);
  assert.equal(queued, false);
});

test("simulateReply marks interested replies and lifts site to negotiating", async () => {
  await seedSites([makeSite("a", 90)]);
  await memoryStore.outreach.upsert("a", {
    status: "sent",
    subject: "Subject",
    draft: "Body",
    sentAt: new Date().toISOString(),
  });

  const result = await simulateReply("a", "interested", memoryStore);

  assert.equal(result.status, "replied_interested");
  assert.equal(result.replyOutcome, "interested");
  assert.ok(result.repliedAt);
  assert.equal((await memoryStore.sites.get("a")).status, "negotiating");
});

test("simulateReply records not_interested without changing site status", async () => {
  await seedSites([makeSite("a", 90, "contacted")]);
  await memoryStore.outreach.upsert("a", {
    status: "sent",
    subject: "S",
    draft: "B",
  });

  const result = await simulateReply("a", "not_interested", memoryStore);

  assert.equal(result.status, "replied_not_interested");
  assert.equal(result.replyOutcome, "not_interested");
  assert.equal((await memoryStore.sites.get("a")).status, "contacted");
});

test("simulateReply rejects unknown outcomes and pre-send statuses", async () => {
  await seedSites([makeSite("a", 90)]);
  await memoryStore.outreach.upsert("a", { status: "awaiting_approval" });

  await assert.rejects(
    () => simulateReply("a", "interested", memoryStore),
    /only allowed after outreach is sent/,
  );

  await memoryStore.outreach.upsert("a", { status: "sent" });
  await assert.rejects(
    () => simulateReply("a", "garbage", memoryStore),
    /Unknown reply outcome/,
  );
});

test("simulateReply allows flipping between reply outcomes", async () => {
  await seedSites([makeSite("a", 90)]);
  await memoryStore.outreach.upsert("a", { status: "sent" });

  let r = await simulateReply("a", "no_reply", memoryStore);
  assert.equal(r.status, "no_reply");

  r = await simulateReply("a", "interested", memoryStore);
  assert.equal(r.status, "replied_interested");
  assert.equal((await memoryStore.sites.get("a")).status, "negotiating");
});
