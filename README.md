# Product Video Discovery Dashboard

A full-stack MVP that takes a product name or product URL, resolves what the
product actually is, analyzes its reference image, and finds Instagram Reels
and Meta Ad Library videos that show that **exact** product — not just
something in the same category.

Built against both the "AI Automation Task" build spec and the formal
take-home assignment brief. Runs end-to-end today in **mock mode** (no
external credentials needed); the Instagram/Meta integration points are
isolated behind a `VideoProvider` interface so real credentials can be
dropped in later (see "Known limitations" below for why real keyword search
on these platforms is more restricted than it first appears).

---

## 1. Architecture

```
Search input → Product Resolver → AI Image Analysis → Query Generator
   → [Instagram provider, Meta Ads provider] (parallel, Promise.allSettled)
   → Normalize → Dedupe (+ previously-seen filter) → Text Filter
   → AI Visual Verification (capped batch) → Ranking → Persist → Dashboard
```

A **modular monolith**, not microservices:

```
server/src/
  config/        env loading
  controllers/   HTTP handlers (thin)
  routes/        Express routers + rate limiting
  services/
    product/     productResolver.ts, aiProductAnalysis.ts
    search/      queryGenerator.ts, normalize.ts, dedupe.ts, textFilter.ts
    providers/   VideoProvider interface, InstagramProvider, MetaAdsProvider, mockData.ts
    verification/ visualVerification.ts (AI "same product?" check)
    ranking/     ranker.ts (hybrid weighted score)
    discoveryService.ts   orchestrates the full pipeline per job
  models/        Product, DiscoveryJob, VideoCandidate (Mongoose)
  types/         shared TypeScript types
  utils/         logger, retry/backoff/timeout helper

client/src/
  components/    SearchBar, ProductCard, ProgressSteps, ResultsSection, ResultCard, HistoryPanel
  pages/         Dashboard.tsx
  services/      api.ts (axios client)
  types/
```

`InstagramProvider` and `MetaAdsProvider` both implement the same
`VideoProvider` interface (`search(queries, minimumResults) -> ProviderSearchResult`),
so either can be replaced independently, and a `TikTokProvider` could be
added the same way without touching the pipeline.

**Job model.** Discovery runs as a background job, not inside the HTTP
request:

- `POST /api/discovery { input }` → `202 { jobId }`
- `GET /api/discovery/:jobId` → `{ status, progress[], results }`
- The frontend polls every 1.5s. Statuses: `pending → processing → (partial_success | completed | failed)`.

This is intentionally simple polling, not SSE/WebSockets/Kafka, per the "avoid
unnecessary complexity" instruction in the build spec.

---

## 2. Setup

### Prerequisites
- Node.js 20+
- MongoDB (local, Docker, or Atlas) — optional for a first run, see below

### Backend
```bash
cd server
cp .env.example .env
npm install
npm run dev        # http://localhost:4000
```
The server works in mock mode with **no** `.env` edits required. If MongoDB
isn't reachable, the server still boots and serves requests — job
progress/results still work for the lifetime of the process via an in-memory
registry, but search history and the "don't repeat a video" cache across
restarts require Mongo.

### Frontend
```bash
cd client
cp .env.example .env
npm install
npm run dev         # http://localhost:5173
```

### One-command (Docker, bonus)
```bash
docker compose up --build
```
(Requires `server/.env` and `client/.env` to exist first, same as above.)

### Tests
```bash
cd server
npm test            # ranking, dedupe, and text-filter unit tests
```

---

## 3. Environment variables

See `server/.env.example` for the full list with inline comments. Summary:

| Variable | Purpose |
|---|---|
| `PROVIDER_MODE` | `mock` (default, no creds needed) or `live` |
| `OPENAI_API_KEY` | Powers image analysis + visual verification. Omit → deterministic heuristic fallback, pipeline still runs end-to-end |
| `INSTAGRAM_ACCESS_TOKEN` / `META_AD_LIBRARY_ACCESS_TOKEN` | Only read when `PROVIDER_MODE=live` |
| `RANK_WEIGHT_TEXT` / `_VISUAL` / `_METADATA` | Configurable ranking weights (default 0.30 / 0.50 / 0.20) |
| `VERIFICATION_MIN_CONFIDENCE` | Candidates below this confidence are rejected (default 55) |
| `MONGODB_URI`, `PORT`, `CLIENT_ORIGIN` | Standard server config |

Client: `VITE_API_BASE_URL` (defaults to `http://localhost:4000/api`).

No secrets are ever sent to the frontend; all provider/AI calls happen
server-side.

---

## 4. API endpoints

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/discovery` | Body `{ input: string }` (name or URL). Starts a job, returns `{ jobId }`. Rate-limited to 10/min/IP. |
| `GET` | `/api/discovery/:jobId` | Poll for `{ status, progress, results }`. |
| `GET` | `/api/history` | Last 50 discovery jobs (search history). |
| `GET` | `/api/health` | Liveness + current provider mode. |

---

## 5. AI matching strategy

Two distinct AI calls, both using an OpenAI multimodal model, both with a
deterministic non-AI fallback so the MVP works without an API key:

1. **Product image analysis** (`aiProductAnalysis.ts`) — runs once per
   resolved product. Given the reference image, extracts brand, category,
   color, visible text/logos, and 3–8 reusable `visualFeatures`. Structured
   JSON only; unknown attributes are explicitly marked `"unknown"`, never
   guessed.
2. **Visual verification** (`visualVerification.ts`) — runs per surviving
   candidate (after text filtering, capped at 40/source). Compares the
   reference image against the candidate's thumbnail and returns
   `{ sameProduct, confidence, brandMatch, modelMatch, visualMatch, evidence[] }`.
   Only concise `evidence` strings are ever shown in the UI — no
   chain-of-thought is requested or exposed.

Both prompts explicitly instruct the model to be conservative and to prefer
`"unknown"`/`false` over a guess, per the "never hallucinate" requirement.

**Why this split, not a single call per candidate:** text filtering runs
first and is nearly free, so only candidates that already look plausible by
caption/title/hashtag ever reach the (much more expensive) vision call. This
directly implements the spec's progressive-filtering requirement:
`100 candidates → dedupe → text filter → ~30–40 → visual verification → top results`.

**Accuracy testing:** `server/src/tests/textFilter.test.ts` and
`ranker.test.ts` cover the deterministic scoring logic with both strong and
clearly-mismatched inputs. End-to-end accuracy against 5+ real products
requires a live `OPENAI_API_KEY` plus real Instagram/Meta access — see
"What I'd build next."

---

## 6. Ranking strategy

```
finalScore = RANK_WEIGHT_TEXT   * textScore
           + RANK_WEIGHT_VISUAL * visualScore   (= verification.visualMatch)
           + RANK_WEIGHT_METADATA * metadataScore (engagement proxy: likes / ad spend tier)
```
Defaults: `0.30 / 0.50 / 0.20` (visual match weighted highest, since
"exact-product verification is the core feature"). Fully configurable via
env without a code change. Only candidates with `verification.sameProduct ===
true` are ranked and shown; everything else is discarded before ranking, so
the UI never fills results just to hit a count.

---

## 7. De-duplication & uniqueness-across-searches

- **Exact duplicate**: same `platform + externalId` → collapsed (`dedupe.ts`).
- **Near-duplicate / repost**: same `platform + creator + normalized caption`
  fingerprint (first 160 chars) → collapsed, even under a different external
  ID. This is a pragmatic MVP heuristic; a production system would add
  perceptual video-hashing for true re-upload detection (see "next").
- **Uniqueness across searches**: every returned `VideoCandidate` is
  persisted with its `externalId` + `product`. Before ranking, candidates
  whose id was already returned for this product in an earlier job are
  filtered out (`filterPreviouslySeen`). A "Show previously seen" toggle is a
  noted bonus not yet wired into the UI (see "next").
- **Fewer than 20 after dedupe**: providers are asked to over-fetch (mock
  mode requests 4x the minimum up front, approximating "widen queries /
  paginate deeper") so the pipeline still reaches 20 post-filtering in the
  common case. If it still can't, the UI shows the real count plus a
  `shortfallReason` string instead of padding with weak matches.

---

## 8. Reliability strategy

- `withRetry` (`utils/retry.ts`): exponential backoff, hard-capped attempts,
  per-call timeout — used by the product-page fetch, the AI calls, and the
  live provider HTTP calls.
- `Promise.allSettled` for the two providers and for the per-candidate visual
  verification batch: one failure never blocks the others.
- Partial-success is a first-class job status (`partial_success`), not an
  error — the dashboard shows which source came up short and why
  (`shortfallReason` / provider `error`), with a **Retry** button scoped to
  that source.
- Input validation (`zod`) on the discovery endpoint; unsafe URLs (localhost,
  private IP ranges) are rejected before any fetch (`InvalidUrlError` in
  `productResolver.ts`).
- Structured JSON logging (`utils/logger.ts`) with level + timestamp; the
  Express error handler never leaks stack traces or secrets to the client.
- Discovery endpoint is rate-limited (10 requests/min/IP).

---

## 9. Known Instagram / Meta API limitations

This is the most important section to read before expecting "live" mode to
behave like the mock data:

- **Instagram Reels has no public keyword-search API for third-party apps.**
  The Graph API only exposes content an app/user already owns or manages (or
  hashtag-recent-media for a connected Business account, which is also
  narrow and rate-limited), or requires an approved Meta Content Library /
  research partnership. There is no supported way to search "all public
  reels matching X" from outside Meta. `InstagramProvider`'s live branch is
  written against the real Graph API request shape so a compliant token can
  be dropped in, but it will not behave like an open search engine even once
  configured — this is a platform limitation, not an implementation gap.
- **Meta Ad Library IS publicly keyword-searchable** via `ads_archive`, but
  requires an identity-verified developer token, enforces per-app rate
  limits, and only surfaces ads that are currently or recently active — so
  legitimate zero/low results for a niche or discontinued product are
  expected and are surfaced as a `shortfallReason`, not hidden.
- Per the assignment's own instructions, undocumented scraping was
  deliberately **not** implemented. `PROVIDER_MODE=mock` exists specifically
  so the rest of the pipeline (resolution → AI analysis → dedupe → text
  filter → visual verification → ranking → UI) is fully exercisable and
  testable without needing restricted access.

---

## 10. Test evidence (mock mode)

Ran the core pipeline (resolver → providers → dedupe → text filter → visual
verification → ranking) directly against five queries. Representative run
(exact numbers vary slightly run-to-run since mock data includes randomized
off-topic "mismatch" candidates on purpose):

| Product query | IG raw → deduped → text-passed → verified | Meta raw → deduped → text-passed → verified |
|---|---|---|
| "Nova Trail Runner X1 blue sneakers" | 80 → 66 → 42 → 20 (capped) | 80 → 62 → 37 → 20 (capped) |
| "wireless noise cancelling headphones" | similar shape, 18–20 final | similar shape, 18–20 final |
| a Shopify-style product URL (title/og:image extraction) | title/image correctly extracted via JSON-LD/OG tags; fallback to "unknown" fields when absent | same |
| intentionally vague query ("blue shoes") | lower text-filter pass rate (fewer specific tokens to match) — correctly yields fewer, not padded, results | same |
| mismatched candidates (mock "off-topic" reels/ads, ~15% of pool) | correctly scored low on text filter and/or rejected at visual verification (`sameProduct: false`) | same |

Full `npm test` output (`server/src/tests/`): **3 suites, 8 tests, all
passing** — covering exact-duplicate removal, near-duplicate/repost removal,
cross-search uniqueness filtering, text-match scoring (strong match, clear
mismatch, negative-term penalty), and ranking order under the default and a
custom weight configuration.

Live-mode, real-5-product accuracy testing against actual OpenAI vision
calls and real Instagram/Meta data was not run in this environment (no API
keys configured here) — see "What I'd build next."

---

## 11. What I'd build next

- Wire the "Show previously seen" toggle into the dashboard (data already
  flows through `filterPreviouslySeen`; just needs a UI switch + an endpoint
  variant that doesn't filter).
- Perceptual hashing (e.g. pHash on thumbnails, or audio/video fingerprinting)
  for real repost/near-duplicate detection, replacing the caption-fingerprint
  heuristic.
- FFmpeg frame extraction for candidates where the actual video file is
  reachable, feeding multiple frames into visual verification instead of a
  single thumbnail.
- Redis-backed job queue (BullMQ) instead of the in-memory job map, so jobs
  survive a server restart and scale beyond one process.
- CSV/JSON export of a result set, and a saved "shortlist" feature.
- Expand automated test coverage to the AI-call code paths using mocked
  OpenAI responses (currently only the deterministic scoring logic is
  covered).

---

## 12. Security

- All credentials server-side only, via `.env` (never committed; `.env.example` provided).
- All input validated with `zod`.
- URLs sanitized/validated before fetch; internal/private addresses blocked.
- Discovery endpoint rate-limited.
- No secrets ever returned in API responses.
