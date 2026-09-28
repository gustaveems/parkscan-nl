-- ParkScan NL schema (Postgres 16 + PostGIS 3.4)
-- Every statement is idempotent so this file can be re-run safely on startup.

CREATE EXTENSION IF NOT EXISTS postgis;

-- ── scan_targets ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS scan_targets (
  id           TEXT PRIMARY KEY,
  city         TEXT NOT NULL,
  district     TEXT,
  area_type    TEXT,                              -- 'polygon' | 'circle' | NULL
  area_label   TEXT,                              -- UI-friendly fallback label
  area_meta    JSONB,                             -- { center, radiusM, areaKm2, vertexCount, ... }
  polygon      geometry(Polygon, 4326),           -- raw polygon for custom areas
  created_by   TEXT,                              -- reserved for future auth work
  status       TEXT NOT NULL DEFAULT 'running',
  site_count   INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS scan_targets_polygon_gix ON scan_targets USING GIST (polygon);
CREATE INDEX IF NOT EXISTS scan_targets_created_at_idx ON scan_targets (created_at DESC);

-- ── sites ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sites (
  id            TEXT PRIMARY KEY,
  scan_id       TEXT NOT NULL REFERENCES scan_targets(id) ON DELETE CASCADE,
  city          TEXT NOT NULL,
  district      TEXT,
  address       TEXT NOT NULL,
  street        TEXT,
  house_number  TEXT,
  postcode      TEXT,
  lat           DOUBLE PRECISION NOT NULL,
  lng           DOUBLE PRECISION NOT NULL,
  geom          geometry(Point, 4326) GENERATED ALWAYS AS
                (ST_SetSRID(ST_MakePoint(lng, lat), 4326)) STORED,
  bag_id        TEXT NOT NULL,
  parcel_ref    TEXT,
  build_year    INTEGER,
  use_purpose   TEXT,
  area_sqm      INTEGER,
  bag_status    TEXT,
  status        TEXT NOT NULL DEFAULT 'identified',
  street_view_url TEXT,
  map_image_url   TEXT,
  street_view_available BOOLEAN,
  context       JSONB,
  frontage      JSONB,
  enriched_at   TIMESTAMPTZ,
  contacted_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sites_scan_id_idx ON sites (scan_id);
CREATE INDEX IF NOT EXISTS sites_status_idx ON sites (status);
CREATE INDEX IF NOT EXISTS sites_geom_gix ON sites USING GIST (geom);

-- ── site_scores (one per site, latest model version wins) ───────────────────
CREATE TABLE IF NOT EXISTS site_scores (
  site_id        TEXT PRIMARY KEY REFERENCES sites(id) ON DELETE CASCADE,
  vacancy_score  INTEGER NOT NULL,
  parking_score  INTEGER NOT NULL,
  confidence     TEXT NOT NULL,                -- 'low' | 'medium' | 'high'
  reasons        JSONB NOT NULL DEFAULT '[]'::jsonb,
  model_version  TEXT,
  scored_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS site_scores_vacancy_idx ON site_scores (vacancy_score DESC);

-- ── owner_lookups ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS owner_lookups (
  site_id               TEXT PRIMARY KEY REFERENCES sites(id) ON DELETE CASCADE,
  owner_name            TEXT NOT NULL,
  parcel_ref            TEXT,
  ownership_type        TEXT,
  ownership_confidence  TEXT,
  restrictions          JSONB NOT NULL DEFAULT '[]'::jsonb,
  source                TEXT,
  retrieved_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  retrieved_by          TEXT                        -- reserved for audit log
);

-- ── conversions ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS conversions (
  site_id              TEXT PRIMARY KEY REFERENCES sites(id) ON DELETE CASCADE,
  spaces_est           INTEGER NOT NULL,
  spaces_low           INTEGER,
  spaces_high          INTEGER,
  usable_area_sqm      INTEGER,
  layout_efficiency    NUMERIC(5,2),
  sqm_per_space        NUMERIC(6,2),
  monthly_rate_per_space NUMERIC(10,2),
  occupancy_low        NUMERIC(5,2),
  occupancy_base       NUMERIC(5,2),
  occupancy_high       NUMERIC(5,2),
  revenue_low          NUMERIC(12,2),
  revenue_base         NUMERIC(12,2),
  revenue_high         NUMERIC(12,2),
  setup_cost_low       NUMERIC(12,2),
  setup_cost_base      NUMERIC(12,2),
  setup_cost_high      NUMERIC(12,2),
  operating_cost_monthly NUMERIC(12,2),
  net_revenue_monthly  NUMERIC(12,2),
  annual_gross_revenue NUMERIC(12,2),
  annual_net_revenue   NUMERIC(12,2),
  activation_days_low  INTEGER,
  activation_days_high INTEGER,
  roi_months           INTEGER,
  roi_months_low       INTEGER,
  roi_months_high      INTEGER,
  payback_years        NUMERIC(5,1),
  annual_roi_pct       INTEGER,
  assumptions          JSONB NOT NULL DEFAULT '[]'::jsonb,
  model_version        TEXT,
  computed_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE conversions ADD COLUMN IF NOT EXISTS spaces_low INTEGER;
ALTER TABLE conversions ADD COLUMN IF NOT EXISTS spaces_high INTEGER;
ALTER TABLE conversions ADD COLUMN IF NOT EXISTS usable_area_sqm INTEGER;
ALTER TABLE conversions ADD COLUMN IF NOT EXISTS layout_efficiency NUMERIC(5,2);
ALTER TABLE conversions ADD COLUMN IF NOT EXISTS sqm_per_space NUMERIC(6,2);
ALTER TABLE conversions ADD COLUMN IF NOT EXISTS monthly_rate_per_space NUMERIC(10,2);
ALTER TABLE conversions ADD COLUMN IF NOT EXISTS occupancy_low NUMERIC(5,2);
ALTER TABLE conversions ADD COLUMN IF NOT EXISTS occupancy_base NUMERIC(5,2);
ALTER TABLE conversions ADD COLUMN IF NOT EXISTS occupancy_high NUMERIC(5,2);
ALTER TABLE conversions ADD COLUMN IF NOT EXISTS setup_cost_base NUMERIC(12,2);
ALTER TABLE conversions ADD COLUMN IF NOT EXISTS operating_cost_monthly NUMERIC(12,2);
ALTER TABLE conversions ADD COLUMN IF NOT EXISTS net_revenue_monthly NUMERIC(12,2);
ALTER TABLE conversions ADD COLUMN IF NOT EXISTS annual_gross_revenue NUMERIC(12,2);
ALTER TABLE conversions ADD COLUMN IF NOT EXISTS annual_net_revenue NUMERIC(12,2);
ALTER TABLE conversions ADD COLUMN IF NOT EXISTS roi_months INTEGER;
ALTER TABLE conversions ADD COLUMN IF NOT EXISTS roi_months_low INTEGER;
ALTER TABLE conversions ADD COLUMN IF NOT EXISTS roi_months_high INTEGER;
ALTER TABLE conversions ADD COLUMN IF NOT EXISTS payback_years NUMERIC(5,1);
ALTER TABLE conversions ADD COLUMN IF NOT EXISTS annual_roi_pct INTEGER;
ALTER TABLE conversions ADD COLUMN IF NOT EXISTS assumptions JSONB NOT NULL DEFAULT '[]'::jsonb;

-- ── outreach ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS outreach (
  site_id          TEXT PRIMARY KEY REFERENCES sites(id) ON DELETE CASCADE,
  subject          TEXT,
  draft            TEXT,
  provider         TEXT,                                   -- 'mock' | 'gemini-api' | 'vertex-gemini'
  status           TEXT NOT NULL DEFAULT 'queued',
  delivery_mode    TEXT,
  delivery_to      TEXT,
  queued_at        TIMESTAMPTZ,
  approved_at      TIMESTAMPTZ,
  sent_at          TIMESTAMPTZ,
  attempt_count    INTEGER NOT NULL DEFAULT 0,
  last_attempt_at  TIMESTAMPTZ,
  last_error       TEXT,
  message_id       TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE outreach ADD COLUMN IF NOT EXISTS delivery_mode TEXT;
ALTER TABLE outreach ADD COLUMN IF NOT EXISTS delivery_to TEXT;
ALTER TABLE outreach ADD COLUMN IF NOT EXISTS queued_at TIMESTAMPTZ;
ALTER TABLE outreach ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
ALTER TABLE outreach ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE outreach ADD COLUMN IF NOT EXISTS last_attempt_at TIMESTAMPTZ;
ALTER TABLE outreach ADD COLUMN IF NOT EXISTS last_error TEXT;
ALTER TABLE outreach ADD COLUMN IF NOT EXISTS message_id TEXT;
ALTER TABLE outreach ADD COLUMN IF NOT EXISTS replied_at TIMESTAMPTZ;
ALTER TABLE outreach ADD COLUMN IF NOT EXISTS reply_outcome TEXT;

CREATE INDEX IF NOT EXISTS outreach_status_idx ON outreach (status);
CREATE INDEX IF NOT EXISTS outreach_queued_at_idx ON outreach (queued_at DESC);

-- ── audit_log (stub — populated when auth lands) ────────────────────────────
CREATE TABLE IF NOT EXISTS audit_log (
  id          BIGSERIAL PRIMARY KEY,
  actor       TEXT,
  action      TEXT NOT NULL,
  subject_id  TEXT,
  metadata    JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_log_subject_idx ON audit_log (subject_id);
CREATE INDEX IF NOT EXISTS audit_log_created_at_idx ON audit_log (created_at DESC);
