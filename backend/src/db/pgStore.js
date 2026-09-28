import { getPool } from "./pool.js";

// ── row → app object mappers ────────────────────────────────────────────────
function toIso(v) {
  if (!v) return null;
  return typeof v?.toISOString === "function" ? v.toISOString() : v;
}

function rowToScan(row) {
  if (!row) return null;
  let area = null;
  if (row.area_type) {
    area = {
      type: row.area_type,
      ...(row.area_meta || {}),
      geometry: row.polygon_geojson ? JSON.parse(row.polygon_geojson) : null,
    };
  }
  return {
    id: row.id,
    city: row.city,
    district: row.district,
    area,
    areaLabel: row.area_label,
    status: row.status,
    siteCount: row.site_count,
    createdAt: toIso(row.created_at),
  };
}

function rowToSite(row) {
  if (!row) return null;
  return {
    id: row.id,
    scanId: row.scan_id,
    city: row.city,
    district: row.district,
    address: row.address,
    street: row.street,
    houseNumber: row.house_number,
    postcode: row.postcode,
    lat: Number(row.lat),
    lng: Number(row.lng),
    bagId: row.bag_id,
    parcelRef: row.parcel_ref,
    buildYear: row.build_year,
    usePurpose: row.use_purpose,
    areaSqm: row.area_sqm,
    bagStatus: row.bag_status,
    status: row.status,
    streetViewUrl: row.street_view_url,
    mapImageUrl: row.map_image_url,
    streetViewAvailable: row.street_view_available,
    context: row.context || null,
    frontage: row.frontage || null,
    enrichedAt: toIso(row.enriched_at),
    contactedAt: toIso(row.contacted_at),
    createdAt: toIso(row.created_at),
  };
}

function rowToScore(row) {
  if (!row) return null;
  return {
    vacancyScore: row.vacancy_score,
    parkingScore: row.parking_score,
    confidence: row.confidence,
    reasons: row.reasons || [],
    modelVersion: row.model_version,
    scoredAt: toIso(row.scored_at),
  };
}

function rowToOwner(row) {
  if (!row) return null;
  return {
    ownerName: row.owner_name,
    parcelRef: row.parcel_ref,
    ownershipType: row.ownership_type,
    ownershipConfidence: row.ownership_confidence,
    restrictions: row.restrictions || [],
    source: row.source,
    retrievedAt: toIso(row.retrieved_at),
  };
}

function rowToConversion(row) {
  if (!row) return null;
  return {
    spacesEst: row.spaces_est,
    spacesLow: row.spaces_low,
    spacesHigh: row.spaces_high,
    usableAreaSqm: row.usable_area_sqm,
    layoutEfficiency: row.layout_efficiency == null ? null : Number(row.layout_efficiency),
    sqmPerSpace: row.sqm_per_space == null ? null : Number(row.sqm_per_space),
    monthlyRatePerSpace: row.monthly_rate_per_space == null ? null : Number(row.monthly_rate_per_space),
    occupancyLow: row.occupancy_low == null ? null : Number(row.occupancy_low),
    occupancyBase: row.occupancy_base == null ? null : Number(row.occupancy_base),
    occupancyHigh: row.occupancy_high == null ? null : Number(row.occupancy_high),
    revenueLow: row.revenue_low == null ? null : Number(row.revenue_low),
    revenueBase: row.revenue_base == null ? null : Number(row.revenue_base),
    revenueHigh: row.revenue_high == null ? null : Number(row.revenue_high),
    setupCostLow: row.setup_cost_low == null ? null : Number(row.setup_cost_low),
    setupCostBase: row.setup_cost_base == null ? null : Number(row.setup_cost_base),
    setupCostHigh: row.setup_cost_high == null ? null : Number(row.setup_cost_high),
    operatingCostMonthly: row.operating_cost_monthly == null ? null : Number(row.operating_cost_monthly),
    netRevenueMonthly: row.net_revenue_monthly == null ? null : Number(row.net_revenue_monthly),
    annualGrossRevenue: row.annual_gross_revenue == null ? null : Number(row.annual_gross_revenue),
    annualNetRevenue: row.annual_net_revenue == null ? null : Number(row.annual_net_revenue),
    activationDaysLow: row.activation_days_low,
    activationDaysHigh: row.activation_days_high,
    roiMonths: row.roi_months,
    roiMonthsLow: row.roi_months_low,
    roiMonthsHigh: row.roi_months_high,
    paybackYears: row.payback_years == null ? null : Number(row.payback_years),
    annualRoiPct: row.annual_roi_pct,
    assumptions: row.assumptions || [],
    modelVersion: row.model_version,
    computedAt: toIso(row.computed_at),
  };
}

function rowToOutreach(row) {
  if (!row) return null;
  return {
    siteId: row.site_id,
    subject: row.subject || null,
    draft: row.draft,
    provider: row.provider || null,
    status: row.status,
    deliveryMode: row.delivery_mode || null,
    deliveryTo: row.delivery_to || null,
    queuedAt: toIso(row.queued_at),
    approvedAt: toIso(row.approved_at),
    sentAt: toIso(row.sent_at),
    attemptCount: row.attempt_count ?? 0,
    lastAttemptAt: toIso(row.last_attempt_at),
    lastError: row.last_error || null,
    messageId: row.message_id || null,
    repliedAt: toIso(row.replied_at),
    replyOutcome: row.reply_outcome || null,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

// ── Dynamic update helper: maps camelCase keys → snake_case columns ─────────
const SITE_FIELDS = {
  status: "status",
  streetViewUrl: "street_view_url",
  mapImageUrl: "map_image_url",
  streetViewAvailable: "street_view_available",
  context: "context",
  frontage: "frontage",
  enrichedAt: "enriched_at",
  contactedAt: "contacted_at",
  bagStatus: "bag_status",
  usePurpose: "use_purpose",
};

const SITE_JSON_FIELDS = new Set(["context", "frontage"]);

function buildUpdate(table, id, patch, fieldMap, jsonFields = new Set()) {
  const sets = [];
  const values = [];
  let i = 1;
  for (const [k, col] of Object.entries(fieldMap)) {
    if (!(k in patch)) continue;
    if (jsonFields.has(k)) {
      sets.push(`${col} = $${i}::jsonb`);
      values.push(patch[k] == null ? null : JSON.stringify(patch[k]));
    } else {
      sets.push(`${col} = $${i}`);
      values.push(patch[k]);
    }
    i++;
  }
  if (sets.length === 0) return null;
  sets.push(`updated_at = now()`);
  values.push(id);
  return {
    text: `UPDATE ${table} SET ${sets.join(", ")} WHERE id = $${i} RETURNING *`,
    values,
  };
}

// ── Store implementation ────────────────────────────────────────────────────
async function q(text, values) {
  const pool = getPool();
  return pool.query(text, values);
}

const SCAN_SELECT = `
  SELECT id, city, district, area_type, area_label, area_meta, status,
         site_count, created_at,
         CASE WHEN polygon IS NULL THEN NULL
              ELSE ST_AsGeoJSON(polygon) END AS polygon_geojson
  FROM scan_targets
`;

export const pgStore = {
  name: "postgres",

  scans: {
    async get(id) {
      const { rows } = await q(`${SCAN_SELECT} WHERE id = $1`, [id]);
      return rowToScan(rows[0]);
    },
    async list() {
      const { rows } = await q(`${SCAN_SELECT} ORDER BY created_at DESC LIMIT 200`);
      return rows.map(rowToScan);
    },
    async create(scan) {
      const { id, city, district = null, area = null, areaLabel = null,
              status = "running", siteCount = 0, createdAt = new Date().toISOString() } = scan;
      const areaType = area?.type || null;
      const { center = null, radiusM = null, areaKm2 = null, vertexCount = null } = area || {};
      const areaMeta = area
        ? JSON.stringify({ center, radiusM, areaKm2, vertexCount })
        : null;
      const polygonGeoJSON = area?.geometry ? JSON.stringify(area.geometry) : null;

      await q(
        `INSERT INTO scan_targets
          (id, city, district, area_type, area_label, area_meta, polygon,
           status, site_count, created_at)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb,
                 CASE WHEN $7::text IS NULL THEN NULL ELSE ST_SetSRID(ST_GeomFromGeoJSON($7), 4326) END,
                 $8,$9,$10)`,
        [id, city, district, areaType, areaLabel, areaMeta, polygonGeoJSON,
         status, siteCount, createdAt],
      );
      return scan;
    },
    async update(id, patch) {
      const fields = {
        status: "status",
        siteCount: "site_count",
        areaLabel: "area_label",
      };
      const upd = buildUpdate("scan_targets", id, patch, fields);
      if (!upd) return this.get(id);
      await q(upd.text, upd.values);
      return this.get(id);
    },
  },

  sites: {
    async get(id) {
      const { rows } = await q(`SELECT * FROM sites WHERE id = $1`, [id]);
      return rowToSite(rows[0]);
    },
    async listByScan(scanId) {
      const { rows } = await q(`SELECT * FROM sites WHERE scan_id = $1`, [scanId]);
      return rows.map(rowToSite);
    },
    async listAll() {
      const { rows } = await q(`SELECT * FROM sites`);
      return rows.map(rowToSite);
    },
    async bulkCreate(arr) {
      if (!arr.length) return;
      const pool = getPool();
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        for (const s of arr) {
          await client.query(
            `INSERT INTO sites
              (id, scan_id, city, district, address, street, house_number, postcode,
               lat, lng, bag_id, parcel_ref, build_year, use_purpose, area_sqm,
               bag_status, status, created_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
             ON CONFLICT (id) DO NOTHING`,
            [
              s.id, s.scanId, s.city, s.district, s.address, s.street,
              s.houseNumber, s.postcode, s.lat, s.lng, s.bagId, s.parcelRef,
              s.buildYear, s.usePurpose, s.areaSqm, s.bagStatus,
              s.status || "identified", s.createdAt || new Date().toISOString(),
            ],
          );
        }
        await client.query("COMMIT");
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      } finally {
        client.release();
      }
    },
    async update(id, patch) {
      const upd = buildUpdate("sites", id, patch, SITE_FIELDS, SITE_JSON_FIELDS);
      if (!upd) return this.get(id);
      const { rows } = await q(upd.text, upd.values);
      return rowToSite(rows[0]);
    },
  },

  scores: {
    async get(siteId) {
      const { rows } = await q(`SELECT * FROM site_scores WHERE site_id = $1`, [siteId]);
      return rowToScore(rows[0]);
    },
    async set(siteId, s) {
      const { rows } = await q(
        `INSERT INTO site_scores
          (site_id, vacancy_score, parking_score, confidence, reasons, model_version, scored_at)
         VALUES ($1,$2,$3,$4,$5::jsonb,$6,now())
         ON CONFLICT (site_id) DO UPDATE SET
           vacancy_score = EXCLUDED.vacancy_score,
           parking_score = EXCLUDED.parking_score,
           confidence    = EXCLUDED.confidence,
           reasons       = EXCLUDED.reasons,
           model_version = EXCLUDED.model_version,
           scored_at     = now()
         RETURNING *`,
        [siteId, s.vacancyScore, s.parkingScore, s.confidence,
         JSON.stringify(s.reasons ?? []), s.modelVersion ?? null],
      );
      return rowToScore(rows[0]);
    },
    async listAll() {
      const { rows } = await q(`SELECT * FROM site_scores`);
      return rows.map(rowToScore);
    },
  },

  owners: {
    async get(siteId) {
      const { rows } = await q(`SELECT * FROM owner_lookups WHERE site_id = $1`, [siteId]);
      return rowToOwner(rows[0]);
    },
    async set(siteId, o) {
      const { rows } = await q(
        `INSERT INTO owner_lookups
          (site_id, owner_name, parcel_ref, ownership_type, ownership_confidence,
           restrictions, source, retrieved_at)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,now())
         ON CONFLICT (site_id) DO UPDATE SET
           owner_name = EXCLUDED.owner_name,
           parcel_ref = EXCLUDED.parcel_ref,
           ownership_type = EXCLUDED.ownership_type,
           ownership_confidence = EXCLUDED.ownership_confidence,
           restrictions = EXCLUDED.restrictions,
           source = EXCLUDED.source,
           retrieved_at = now()
         RETURNING *`,
        [siteId, o.ownerName, o.parcelRef, o.ownershipType, o.ownershipConfidence,
         JSON.stringify(o.restrictions ?? []), o.source ?? "kadaster"],
      );
      return rowToOwner(rows[0]);
    },
    async count() {
      const { rows } = await q(`SELECT COUNT(*)::int AS n FROM owner_lookups`);
      return rows[0].n;
    },
    async listByName(ownerName) {
      if (!ownerName) return [];
      const { rows } = await q(
        `SELECT site_id, owner_name, parcel_ref, ownership_type, ownership_confidence,
                restrictions, source, retrieved_at
         FROM owner_lookups
         WHERE LOWER(TRIM(owner_name)) = LOWER(TRIM($1))`,
        [ownerName],
      );
      return rows.map((r) => ({
        siteId: r.site_id,
        ...rowToOwner(r),
      }));
    },
  },

  conversions: {
    async get(siteId) {
      const { rows } = await q(`SELECT * FROM conversions WHERE site_id = $1`, [siteId]);
      return rowToConversion(rows[0]);
    },
    async set(siteId, c) {
      const { rows } = await q(
        `INSERT INTO conversions
          (site_id, spaces_est, spaces_low, spaces_high, usable_area_sqm,
           layout_efficiency, sqm_per_space, monthly_rate_per_space,
           occupancy_low, occupancy_base, occupancy_high,
           revenue_low, revenue_base, revenue_high,
           setup_cost_low, setup_cost_base, setup_cost_high,
           operating_cost_monthly, net_revenue_monthly,
           annual_gross_revenue, annual_net_revenue,
           activation_days_low, activation_days_high,
           roi_months, roi_months_low, roi_months_high,
           payback_years, annual_roi_pct, assumptions,
           model_version, computed_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29::jsonb,$30,now())
         ON CONFLICT (site_id) DO UPDATE SET
           spaces_est = EXCLUDED.spaces_est,
           spaces_low = EXCLUDED.spaces_low,
           spaces_high = EXCLUDED.spaces_high,
           usable_area_sqm = EXCLUDED.usable_area_sqm,
           layout_efficiency = EXCLUDED.layout_efficiency,
           sqm_per_space = EXCLUDED.sqm_per_space,
           monthly_rate_per_space = EXCLUDED.monthly_rate_per_space,
           occupancy_low = EXCLUDED.occupancy_low,
           occupancy_base = EXCLUDED.occupancy_base,
           occupancy_high = EXCLUDED.occupancy_high,
           revenue_low = EXCLUDED.revenue_low,
           revenue_base = EXCLUDED.revenue_base,
           revenue_high = EXCLUDED.revenue_high,
           setup_cost_low = EXCLUDED.setup_cost_low,
           setup_cost_base = EXCLUDED.setup_cost_base,
           setup_cost_high = EXCLUDED.setup_cost_high,
           operating_cost_monthly = EXCLUDED.operating_cost_monthly,
           net_revenue_monthly = EXCLUDED.net_revenue_monthly,
           annual_gross_revenue = EXCLUDED.annual_gross_revenue,
           annual_net_revenue = EXCLUDED.annual_net_revenue,
           activation_days_low = EXCLUDED.activation_days_low,
           activation_days_high = EXCLUDED.activation_days_high,
           roi_months = EXCLUDED.roi_months,
           roi_months_low = EXCLUDED.roi_months_low,
           roi_months_high = EXCLUDED.roi_months_high,
           payback_years = EXCLUDED.payback_years,
           annual_roi_pct = EXCLUDED.annual_roi_pct,
           assumptions = EXCLUDED.assumptions,
           model_version = EXCLUDED.model_version,
           computed_at = now()
         RETURNING *`,
        [
          siteId, c.spacesEst, c.spacesLow, c.spacesHigh, c.usableAreaSqm,
          c.layoutEfficiency, c.sqmPerSpace, c.monthlyRatePerSpace,
          c.occupancyLow, c.occupancyBase, c.occupancyHigh,
          c.revenueLow, c.revenueBase, c.revenueHigh,
          c.setupCostLow, c.setupCostBase, c.setupCostHigh,
          c.operatingCostMonthly, c.netRevenueMonthly,
          c.annualGrossRevenue, c.annualNetRevenue,
          c.activationDaysLow, c.activationDaysHigh,
          c.roiMonths, c.roiMonthsLow, c.roiMonthsHigh,
          c.paybackYears, c.annualRoiPct,
          JSON.stringify(c.assumptions ?? []),
          c.modelVersion ?? null,
        ],
      );
      return rowToConversion(rows[0]);
    },
  },

  outreach: {
    async get(siteId) {
      const { rows } = await q(`SELECT * FROM outreach WHERE site_id = $1`, [siteId]);
      return rowToOutreach(rows[0]);
    },
    async list({ status } = {}) {
      const values = [];
      const where = status ? `WHERE status = $1` : "";
      if (status) values.push(status);
      const { rows } = await q(
        `SELECT * FROM outreach ${where} ORDER BY COALESCE(updated_at, created_at) DESC`,
        values,
      );
      return rows.map(rowToOutreach);
    },
    async upsert(siteId, patch) {
      const {
        subject = null,
        draft = null,
        provider = null,
        status = null,
        deliveryMode = null,
        deliveryTo = null,
        queuedAt = null,
        approvedAt = null,
        sentAt = null,
        attemptCount = null,
        lastAttemptAt = null,
        lastError = null,
        messageId = null,
        repliedAt = null,
        replyOutcome = null,
      } = patch || {};
      const { rows } = await q(
        `INSERT INTO outreach
           (
             site_id, subject, draft, provider, status,
             delivery_mode, delivery_to, queued_at, approved_at, sent_at,
             attempt_count, last_attempt_at, last_error, message_id,
             replied_at, reply_outcome,
             created_at, updated_at
           )
         VALUES (
           $1, $2, $3, $4, COALESCE($5,'queued'),
           $6, $7, $8, $9, $10,
           COALESCE($11, 0), $12, $13, $14,
           $15, $16,
           now(), now()
         )
         ON CONFLICT (site_id) DO UPDATE SET
           subject = COALESCE(EXCLUDED.subject, outreach.subject),
           draft = COALESCE(EXCLUDED.draft, outreach.draft),
           provider = COALESCE(EXCLUDED.provider, outreach.provider),
           status = COALESCE(EXCLUDED.status, outreach.status),
           delivery_mode = COALESCE(EXCLUDED.delivery_mode, outreach.delivery_mode),
           delivery_to = COALESCE(EXCLUDED.delivery_to, outreach.delivery_to),
           queued_at = COALESCE(EXCLUDED.queued_at, outreach.queued_at),
           approved_at = COALESCE(EXCLUDED.approved_at, outreach.approved_at),
           sent_at = COALESCE(EXCLUDED.sent_at, outreach.sent_at),
           attempt_count = COALESCE(EXCLUDED.attempt_count, outreach.attempt_count),
           last_attempt_at = COALESCE(EXCLUDED.last_attempt_at, outreach.last_attempt_at),
           last_error = COALESCE(EXCLUDED.last_error, outreach.last_error),
           message_id = COALESCE(EXCLUDED.message_id, outreach.message_id),
           replied_at = COALESCE(EXCLUDED.replied_at, outreach.replied_at),
           reply_outcome = COALESCE(EXCLUDED.reply_outcome, outreach.reply_outcome),
           updated_at = now()
         RETURNING *`,
        [
          siteId,
          subject,
          draft,
          provider,
          status,
          deliveryMode,
          deliveryTo,
          queuedAt,
          approvedAt,
          sentAt,
          attemptCount,
          lastAttemptAt,
          lastError,
          messageId,
          repliedAt,
          replyOutcome,
        ],
      );
      return rowToOutreach(rows[0]);
    },
  },
};
