# ParkScan NL

**Vacancy Intelligence & Parking Conversion Platform**

ParkScan turns Dutch open registries (BAG, Kadaster, PDOK) and Google Maps Platform
into a working pipeline for SULC Advisors: scan a district → identify vacant buildings
→ score them → look up owners → draft outreach → ship a printable PDF dossier.

> Built for the SULC Hackathon — Phase 1 ("Manual Assist"). Single-operator workflow
> with the data plumbing in place to scale to Phase 2 (auto-scheduled scans, ML).

![Site Queue](docs/screenshots/02-queue.png)

---

## What it does, end-to-end

1. **Pick an area** — city + named district, free polygon, or radius circle drawn on a MapLibre map.
2. **Resolve buildings** — PDOK Locatieserver returns ~24 real Dutch addresses with BAG IDs and coordinates inside that area.
3. **Enrich** — Google Maps Static + Street View Static (proxied through the backend so your API key never leaves the server), Google Places API for nearby POIs (transit, retail, hospital), Cloud Vision for frontage analysis on the actual Street View image.
4. **Score** — a transparent rules engine produces `vacancyScore` and `parkingScore` (0-100) plus a list of weighted reasons that surface in the UI and the report.
5. **Look up owners** — Kadaster Eigendomsinformatie (currently illustrative — production needs the SULC broker contract; the rest of the data path is real).
6. **Draft outreach** — Gemini 2.5 Flash writes a formal Dutch email referencing the actual owner, BAG status, area, and conversion model.
7. **Ship the PDF** — Puppeteer renders a 7-page dossier with running header/footer, page numbers, and every section.

![Site Detail](docs/screenshots/03-site-detail.png)

---

## Quick Start

```bash
git clone https://github.com/gustaveems/parkscan-nl.git parkscan
cd parkscan
./start.sh
```

Open **http://localhost:5173**. That's it.

`start.sh`:
- Detects Docker → starts a PostGIS container on `:5433` (data persists)
- Falls back to in-memory store if Docker isn't running (data resets on restart, fine for demos)
- Installs npm deps for backend + frontend
- Starts both servers, prints URLs, traps Ctrl+C

If `backend/.env` doesn't exist, `start.sh` will copy `backend/.env.example` for you and tell you which keys to fill in. **Without any keys the product still runs on mocks** — every external service has a deterministic fallback.

---

## API keys (all optional — product works without any of them)

| Variable | What it unlocks | How to get it |
|---|---|---|
| `GOOGLE_MAPS_API_KEY` | Real map tiles, Street View imagery, Places nearby search | [Google Cloud Console](https://console.cloud.google.com/apis/library) → enable Maps Static, Street View Static, Places API (New) |
| `GEMINI_API_KEY` + `GEMINI_MODEL=gemini-2.5-flash` | Real Dutch outreach emails personalised per owner & site | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) (free tier is generous) |
| `GOOGLE_VISION_API_KEY` | Real "shuttered storefront / no signage" detection feeding the score engine | Google Cloud Console → enable Cloud Vision API |
| `BAG_API_KEY` *(optional)* | Replaces synthesized gebruiksdoel/oppervlakte/bouwjaar with real BAG Individuele Bevragingen data | [Kadaster developer portal](https://www.kadaster.nl) — paid |
| `DATABASE_URL` | Postgres persistence (auto-set by `start.sh` when Docker is running) | docker-compose handles this |

Paste them into `backend/.env` and restart. The sidebar widget (`/api/providers`) flips from `Mock` → `Live` for each capability automatically — no code change needed.

```bash
# Verify which providers are live:
curl http://localhost:3001/api/providers
# {"store":"postgres","places":"google_places","streetview":"google_streetview",
#  "maps":"google_maps_static","bag":"pdok_locatieserver",
#  "llm":"gemini_api","vision":"vision_api_key"}
```

---

## Live vs Mock matrix

| Capability | Provider | Status without key | Status with key |
|---|---|---|---|
| Storage | Postgres + PostGIS (Docker) | In-memory (ephemeral) | Durable |
| Building registry (free tier) | PDOK Locatieserver | **Live** (no key needed) | — |
| Building attrs (gebruiksdoel/oppervlakte/bouwjaar) | BAG Bevragingen | Synthesized | **Live** |
| Map imagery | Google Maps Static | Mock placeholder | **Live** |
| Street view | Google Street View Static (4-cardinal) | Mock | **Live** |
| Nearby POIs | Google Places API (New) | Mock | **Live** |
| Frontage analysis | Cloud Vision | Mock (deterministic) | **Live** |
| Outreach email drafting | Gemini 2.5 Flash | Mock template | **Live** |
| Ownership | Kadaster Eigendomsinformatie | Mock (realistic Dutch pool) | Mock — production needs broker contract |
| PDF generation | Puppeteer + Chromium | **Always live** | — |

---

## Architecture

```
                  ┌─────────────────────────────────────────────────┐
   React/Vite     │  Pages: /, /queue, /sites/:id, /report, /stats  │
   + MapLibre     │  Components: ScanMap (polygon/radius drawer),    │
                  │  ScoreRing, ProviderStatus (sidebar)             │
                  └────────────┬────────────────────────────────────┘
                               │  REST
                               ▼
                  ┌─────────────────────────────────────────────────┐
   Express API    │  /api/scans      ← polygon → 24 BAG candidates  │
                  │  /api/sites/:id  → enrich + score + report      │
                  │  /api/providers  → live/mock status              │
                  │  Puppeteer       → /api/sites/:id/report.pdf    │
                  └────────────┬────────────────────────────────────┘
                               │
        ┌──────────────────────┼─────────────────────────────────┐
        ▼                      ▼                                 ▼
  ┌──────────────┐  ┌──────────────────┐         ┌────────────────────┐
  │ PostgreSQL   │  │ Service modules  │         │ External APIs      │
  │ + PostGIS    │  │ bag.js  places.js│ ◄─cache─│ PDOK Locatieserver │
  │              │  │ streetview.js    │         │ Google Maps/SV/Pl. │
  │  scans       │  │ vision.js  llm.js│         │ Cloud Vision       │
  │  sites       │  │ pdf.js           │         │ Gemini 2.5 Flash   │
  │  site_scores │  │ scoringEngine.js │         │ BAG Bevragingen    │
  │  owner_lookups│  └──────────────────┘         │ (Kadaster: mock)   │
  │  conversions │                                └────────────────────┘
  │  outreach    │
  │  frontage    │  Each external service has a mock fallback so the
  └──────────────┘  product runs end-to-end with zero API keys.
```

---

## Pages & API surface

### Frontend pages

| Route | Purpose |
|---|---|
| `/` | District scanner — pick city, draw polygon/radius, trigger scan |
| `/queue` | Ranked candidate table — search, filter by score/status, bulk ownership lookup |
| `/sites/:id` | Site detail — score rings, signals, BAG facts, 360° street view, ownership, conversion model |
| `/sites/:id/report` | Full dossier with editable Gemini-drafted outreach + CRM stage tracker |
| `/sites/:id/report?print=1` | Print-mode rendering used by Puppeteer for the PDF |
| `/stats` | Dashboard — KPIs, score distribution, pipeline funnel, top candidates |

![Scanner](docs/screenshots/01-scanner.png)

### Backend API

| Method + path | Purpose |
|---|---|
| `GET /health` | Storage type + provider snapshot |
| `GET /api/providers` | Live/mock status for each external capability |
| `GET /api/cities` | Available cities + named districts |
| `POST /api/scans` | Create scan; resolves ~24 BAG candidates from PDOK |
| `GET /api/scans` | List scans |
| `GET /api/sites?scanId=` | Sites for a scan, scores attached, sorted by vacancy |
| `GET /api/sites/:id` | Full site detail (incl. score, owner, conversion, frontage, outreach) |
| `POST /api/sites/:id/enrich` | Run Places + Cloud Vision frontage |
| `POST /api/sites/:id/score` | Re-run the scoring engine |
| `POST /api/scans/:id/score-all` | Score every site in a scan (concurrent) |
| `POST /api/sites/:id/ownership` | Kadaster lookup (mock pool) |
| `GET /api/sites/:id/report` | Generate report data + Gemini outreach draft |
| `GET /api/sites/:id/report.pdf` | Puppeteer-rendered PDF (7 pages, ~720 KB) |
| `PATCH /api/sites/:id/outreach` | Update CRM status / email draft |
| `GET /api/stats` | Pipeline stats for dashboard |
| `GET /api/img/streetview?...` | Server-side Street View proxy (keeps API key server-only) |
| `GET /api/img/staticmap?...` | Server-side Maps Static proxy |

---

## The PDF dossier

Each report renders as a 7-page A4 PDF with:

- **Running header**: ParkScan brand mark + truncated address (every page)
- **Running footer**: "Confidential — SULC Advisors · ParkScan NL" + Page X of Y
- **Page 1**: Title block, scores (vacancy + parking rings), full score signals list with weights
- **Page 2**: Building Facts — BAG (14-field record)
- **Page 3**: Visual Survey — wide map + 4-cardinal Street View (N/E/S/W)
- **Page 4**: Context (Places API POIs + demand interpretation), Ownership (with Kadaster disclaimer)
- **Page 5**: Parking Conversion Estimate (hero metrics + revenue range bar chart)
- **Page 6**: Owner Outreach Draft (full Gemini-written Dutch email) + CRM Pipeline
- **Page 7**: Report Metadata + source attribution badges

![Report PDF](docs/screenshots/05-report-pdf-preview.png)

---

## Data model

```sql
scans            id, city, district, polygon (jsonb), area (jsonb), createdAt
sites            id, scanId, address, street, houseNumber, postcode, lat, lng,
                 bagId, parcelRef, buildYear, usePurpose, areaSqm, bagStatus,
                 status, source, frontage (jsonb), enrichedAt
site_scores      siteId, vacancyScore, parkingScore, confidence, reasons (jsonb),
                 modelVersion, scoredAt
owner_lookups    siteId, ownerName, parcelRef, ownershipType, ownershipConfidence,
                 restrictions (jsonb), retrievedAt, source
conversions      siteId, spacesEst, revenueLow/Base/High, setupCostLow/High,
                 activationDaysLow/High, roiMonths
outreach         siteId, subject, draft, provider, status, sentAt, createdAt
```

Schema is in `backend/sql/schema.sql`, applied automatically on backend startup
when Postgres is reachable. Falls back to in-memory Maps with the same shape
when no `DATABASE_URL` is set.

---

## Project layout

```
parkscan/
├── start.sh                       # one-command launcher
├── docker-compose.yml             # PostGIS for local persistence (multi-arch)
├── docs/screenshots/              # README assets (auto-captured)
├── scripts/
│   └── capture-screenshots.mjs    # Puppeteer-driven screenshot generator
│
├── backend/                       # Node 18+ / Express
│   ├── .env.example               # template — copy to .env
│   ├── sql/schema.sql             # idempotent Postgres schema
│   └── src/
│       ├── index.js               # Express app + provider registry
│       ├── routes/api.js          # all API endpoints
│       ├── db/                    # pgStore (Postgres) + memoryStore
│       ├── data/mockData.js       # deterministic mock generators
│       └── services/
│           ├── bag.js             # PDOK Locatieserver + BAG Bevragingen
│           ├── places.js          # Google Places API (New) Nearby Search
│           ├── streetview.js      # Street View Metadata
│           ├── vision.js          # Cloud Vision frontage analysis
│           ├── llm.js             # Gemini outreach drafting
│           ├── pdf.js             # Puppeteer PDF renderer
│           └── scoringEngine.js   # vacancy + parking scoring
│
└── frontend/                      # Vite + React + MapLibre
    └── src/
        ├── pages/
        │   ├── ScanPage.jsx       # /
        │   ├── QueuePage.jsx      # /queue
        │   ├── SitePage.jsx       # /sites/:id
        │   ├── ReportPage.jsx     # /sites/:id/report (single-column dossier)
        │   └── StatsPage.jsx      # /stats
        ├── components/
        │   ├── ScanMap.jsx        # MapLibre + polygon/radius drawer
        │   ├── ScoreRing.jsx
        │   ├── ProviderStatus.jsx # sidebar live/mock indicator
        │   └── Layout.jsx         # sidebar shell (skipped in print mode)
        └── lib/
            ├── api.js             # fetch wrapper
            └── images.js          # backend image-proxy URL helpers
```

---

## Manual start (without `start.sh`)

```bash
# Optional: persistent PostGIS on port 5433
docker compose up -d

# Backend (port 3001)
cd backend
cp .env.example .env       # add your API keys here
npm install
npm start

# Frontend (port 5173) — in another terminal
cd frontend
npm install
npm run dev
```

Health check:

```bash
curl http://localhost:3001/health
curl http://localhost:3001/api/providers
```

---

## What judges should notice

- **Pluggable architecture** — every external service follows the same pattern: `provider()` returns the active backend, `enabled()` is a boolean, calls fall through to `mockX()` on any error. Drop a key in `.env`, restart, and the sidebar widget reflects it.
- **Server-side image proxying** — Google API keys never reach the browser. Map tiles and Street View images flow through `/api/img/*` endpoints, so the demo URL is also production-safe.
- **Real Dutch addresses** — PDOK Locatieserver returns genuine BAG records (NL.IMBAG.Verblijfsobject.* IDs), so every screenshot points at a real building you can verify on [bagviewer.kadaster.nl](https://bagviewer.kadaster.nl).
- **Real Gemini-written Dutch** — outreach emails reference the actual owner name, vacancy score, BAG status, area, conversion bays and revenue range. Not a template.
- **Score signals are inspectable** — every reason has a weight, a signal ID, and a source, surfaced in both the UI and the PDF.
- **The PDF is the on-screen page** — same React component, just rendered with `?print=1`. No separate PDF templating system to drift.
- **Honest provider attribution** — the report's metadata footer reads `Gemini API (live)` or `Mock LLM` based on what actually produced *that report*, not what's currently in `.env`.

---

## Phase 2 — what we deliberately deferred

| Item | Why deferred |
|---|---|
| Background scheduled scanning | Out of scope for a single-operator hackathon demo |
| Real Kadaster ownership | Requires SULC broker contract (legal, not technical) |
| Auth + multi-tenant | Single-user dev; auth would dilute the demo flow |
| Email send (SMTP) | "Mark as Sent" flips DB state; no message leaves the system |
| Production deploy | Hackathon judging is local; one-command launcher covers it |
| Test suite | Trade-off for shipping the full pipeline in time |

The scaffolding for all of these is already in place — see service module patterns and `Phase 2 Roadmap` notes in code comments.

---

## License

Built for the SULC Hackathon by [@gamsoulasieu2024-gif](https://github.com/gamsoulasieu2024-gif). Internal evaluation use.

---

## Provenance (recovered May–Sep 2026)

This repository is the original hackathon codebase (built in Cursor, Apr 2026),
recovered from local editor snapshots after the account that hosted it was
banned. Core files (Express backend, PDOK/BAG + scoring + outreach services,
React + MapLibre frontend, test suites) are the final revisions as they existed
in the original workspace. A handful of files that were never re-saved after
the first snapshot (`index.html`, `main.jsx`, `App.jsx`, `index.css`,
`ScoreRing.jsx`, `ScanMap.jsx/css`) were reconstructed from their consumers
and are functionally equivalent. `docs/screenshots/` and the capture script
were lost; regenerate with `node scripts/capture-screenshots.mjs` once you add
it back, or take manual screenshots for the README.
