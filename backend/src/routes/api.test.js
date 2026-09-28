import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import router from "./api.js";
import { initStore } from "../db/index.js";
import { memoryStore } from "../db/memoryStore.js";

function site(id) {
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
    status: "scored",
    createdAt: new Date().toISOString(),
  };
}

function getRouteHandler(method, path) {
  return router.stack.find((layer) =>
    layer.route?.path === path && layer.route.methods?.[method]
  ).route.stack[0].handle;
}

async function invoke(handler, { params = {}, query = {}, body = {} } = {}) {
  const req = { params, query, body };
  const res = {
    statusCode: 200,
    headers: {},
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    setHeader(key, value) {
      this.headers[key] = value;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    end(payload) {
      this.body = payload;
      return this;
    },
  };
  await handler(req, res);
  return res;
}

beforeEach(async () => {
  memoryStore.__reset();
  delete process.env.DATABASE_URL;
  process.env.OUTREACH_DELIVERY_MODE = "mock";
  process.env.OUTREACH_TEST_TO = "internal@example.com";
  await initStore();
  await memoryStore.scans.create({
    id: "scan-1",
    city: "amsterdam",
    district: "centrum",
    status: "complete",
    siteCount: 1,
    createdAt: new Date().toISOString(),
  });
});

test("GET /api/outreach filters by status", async () => {
  await memoryStore.sites.bulkCreate([site("site-1")]);
  await memoryStore.scores.set("site-1", {
    vacancyScore: 88,
    parkingScore: 60,
    confidence: "high",
    reasons: [],
    modelVersion: "1.0.0",
    scoredAt: new Date().toISOString(),
  });
  await memoryStore.outreach.upsert("site-1", {
    status: "awaiting_approval",
    subject: "Hello",
    draft: "Body",
  });

  const res = await invoke(getRouteHandler("get", "/outreach"), {
    query: { status: "awaiting_approval" },
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.items.length, 1);
  assert.equal(res.body.items[0].outreach.status, "awaiting_approval");
});

test("POST /api/scans/:scanId/outreach queues eligible sites", async () => {
  await memoryStore.sites.bulkCreate([site("site-1")]);
  await memoryStore.scores.set("site-1", {
    vacancyScore: 91,
    parkingScore: 60,
    confidence: "high",
    reasons: [],
    modelVersion: "1.0.0",
    scoredAt: new Date().toISOString(),
  });

  const res = await invoke(getRouteHandler("post", "/scans/:scanId/outreach"), {
    params: { scanId: "scan-1" },
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.queued, 1);
  assert.equal((await memoryStore.outreach.get("site-1")).status, "awaiting_approval");
});

test("approve-send, retry, and skip endpoints operate on outreach items", async () => {
  await memoryStore.sites.bulkCreate([site("site-1")]);
  await memoryStore.scores.set("site-1", {
    vacancyScore: 91,
    parkingScore: 60,
    confidence: "high",
    reasons: [],
    modelVersion: "1.0.0",
    scoredAt: new Date().toISOString(),
  });
  await memoryStore.outreach.upsert("site-1", {
    status: "awaiting_approval",
    subject: "Hello",
    draft: "Body",
  });

  const sendRes = await invoke(getRouteHandler("post", "/outreach/:siteId/approve-send"), {
    params: { siteId: "site-1" },
  });
  assert.equal(sendRes.statusCode, 200);
  assert.equal(sendRes.body.outreach.status, "sent");

  await memoryStore.outreach.upsert("site-1", { status: "failed", lastError: "SMTP down" });
  const retryRes = await invoke(getRouteHandler("post", "/outreach/:siteId/retry"), {
    params: { siteId: "site-1" },
  });
  assert.equal(retryRes.statusCode, 200);
  assert.equal(retryRes.body.outreach.status, "queued");

  await memoryStore.outreach.upsert("site-1", { status: "awaiting_approval" });
  const skipRes = await invoke(getRouteHandler("post", "/outreach/:siteId/skip"), {
    params: { siteId: "site-1" },
  });
  assert.equal(skipRes.statusCode, 200);
  assert.equal(skipRes.body.outreach.status, "skipped");
});
