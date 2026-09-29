// In-memory store, used when DATABASE_URL is not configured.
// Keeps the same async interface as the Postgres store so routes are DB-agnostic.

const scans = new Map();
const sites = new Map();
const scores = new Map();
const owners = new Map();
const conversions = new Map();
const outreach = new Map();

function sortByNewest(values, key) {
  return values.sort((a, b) => new Date(b[key] || 0) - new Date(a[key] || 0));
}

export const memoryStore = {
  name: "memory",

  scans: {
    async get(id) {
      return scans.get(id) ? { ...scans.get(id) } : null;
    },
    async list() {
      return [...scans.values()]
        .map((s) => ({ ...s }))
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    },
    async create(scan) {
      scans.set(scan.id, { ...scan });
      return { ...scan };
    },
    async update(id, patch) {
      const existing = scans.get(id);
      if (!existing) return null;
      const next = { ...existing, ...patch };
      scans.set(id, next);
      return { ...next };
    },
  },

  sites: {
    async get(id) {
      return sites.get(id) ? { ...sites.get(id) } : null;
    },
    async listByScan(scanId) {
      return [...sites.values()]
        .filter((s) => s.scanId === scanId)
        .map((s) => ({ ...s }));
    },
    async listAll() {
      return [...sites.values()].map((s) => ({ ...s }));
    },
    async bulkCreate(arr) {
      for (const s of arr) sites.set(s.id, { ...s });
    },
    async update(id, patch) {
      const existing = sites.get(id);
      if (!existing) return null;
      const next = { ...existing, ...patch };
      sites.set(id, next);
      return { ...next };
    },
  },

  scores: {
    async get(siteId) {
      return scores.get(siteId) ? { ...scores.get(siteId) } : null;
    },
    async set(siteId, scoreObj) {
      scores.set(siteId, { ...scoreObj });
      return { ...scoreObj };
    },
    async listAll() {
      return [...scores.values()].map((s) => ({ ...s }));
    },
  },

  owners: {
    async get(siteId) {
      return owners.get(siteId) ? { ...owners.get(siteId) } : null;
    },
    async set(siteId, ownerObj) {
      owners.set(siteId, { ...ownerObj });
      return { ...ownerObj };
    },
    async count() {
      return owners.size;
    },
    async listByName(ownerName) {
      if (!ownerName) return [];
      const target = ownerName.trim().toLowerCase();
      const matches = [];
      for (const [siteId, owner] of owners.entries()) {
        if ((owner.ownerName || "").trim().toLowerCase() === target) {
          matches.push({ siteId, ...owner });
        }
      }
      return matches;
    },
  },

  conversions: {
    async get(siteId) {
      return conversions.get(siteId) ? { ...conversions.get(siteId) } : null;
    },
    async set(siteId, convObj) {
      conversions.set(siteId, { ...convObj });
      return { ...convObj };
    },
  },

  outreach: {
    async get(siteId) {
      return outreach.get(siteId) ? { ...outreach.get(siteId) } : null;
    },
    async list({ status } = {}) {
      const items = [...outreach.entries()].map(([siteId, item]) => ({ siteId, ...item }));
      const filtered = status ? items.filter((item) => item.status === status) : items;
      return sortByNewest(filtered, "updatedAt").map((item) => ({ ...item }));
    },
    async upsert(siteId, patch) {
      const existing = outreach.get(siteId) || {
        createdAt: new Date().toISOString(),
        attemptCount: 0,
      };
      const next = {
        ...existing,
        ...patch,
        updatedAt: new Date().toISOString(),
      };
      outreach.set(siteId, next);
      return { siteId, ...next };
    },
  },

  __reset() {
    scans.clear();
    sites.clear();
    scores.clear();
    owners.clear();
    conversions.clear();
    outreach.clear();
  },
};

// Browser demo store accessor (mirrors backend db/index.js)
export function getStore() {
  return memoryStore;
}
export function initStore() {
  return Promise.resolve(memoryStore);
}
