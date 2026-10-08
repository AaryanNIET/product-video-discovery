import path from "path";
import dotenv from "dotenv";
dotenv.config();

function num(val: string | undefined, fallback: number): number {
  if (!val) return fallback;
  const n = Number(val);
  return Number.isFinite(n) ? n : fallback;
}

function bool(val: string | undefined, fallback: boolean): boolean {
  if (val === undefined || val === "") return fallback;
  return ["1", "true", "yes", "on"].includes(val.toLowerCase());
}

export const env = {
  port: num(process.env.PORT, 4000),
  nodeEnv: process.env.NODE_ENV || "development",
  clientOrigin: process.env.CLIENT_ORIGIN || "http://localhost:5173",
  mongodbUri: process.env.MONGODB_URI || "mongodb://localhost:27017/product-video-discovery",

  /** "live" scrapes real data through Apify; "mock" uses generated data (offline dev / tests). */
  providerMode: (process.env.PROVIDER_MODE || "live") as "mock" | "live",

  apify: {
    token: process.env.APIFY_TOKEN || "",
    instagramActor: process.env.APIFY_INSTAGRAM_ACTOR || "apify~instagram-hashtag-scraper",
    metaAdsActor: process.env.APIFY_META_ADS_ACTOR || "apify~facebook-ads-scraper",
    tiktokActor: process.env.APIFY_TIKTOK_ACTOR || "clockworks~tiktok-scraper",
    /** Hard cap on one actor run, in seconds (Apify's sync API allows up to 300). */
    runTimeoutSec: num(process.env.APIFY_RUN_TIMEOUT_SEC, 240),
    /** Country code used for Ad Library searches ("ALL" = every country). */
    adLibraryCountry: process.env.META_ADS_COUNTRY || "ALL",
  },

  gemini: {
    apiKey: process.env.GEMINI_API_KEY || "",
    model: process.env.GEMINI_MODEL || "gemini-2.5-flash",
    /** Parallel Gemini requests. Keep low on the free tier (requests-per-minute limits). */
    concurrency: num(process.env.GEMINI_CONCURRENCY, 3),
    /** Candidate thumbnails compared against the reference image in one request. */
    batchSize: num(process.env.GEMINI_BATCH_SIZE, 6),
  },

  tiktok: {
    /** Server-side default for the optional TikTok source; the UI toggle can only turn it on when this is true. */
    enabled: bool(process.env.ENABLE_TIKTOK, true),
  },

  matching: {
    /** Videos scoring below this (0-100) are marked "below threshold" and do not count toward the 20 minimum. */
    threshold: num(process.env.MATCH_THRESHOLD, 65),
    perSourceMinimum: num(process.env.PER_SOURCE_MINIMUM, 20),
    /** Max scrape rounds per source (each round uses wider queries / deeper pages). */
    maxRounds: num(process.env.MAX_SEARCH_ROUNDS, 3),
    /** Cost guard: never vision-score more than this many candidates per source per search. */
    maxVisionPerSource: num(process.env.MAX_VISION_PER_SOURCE, 90),
  },

  jobs: {
    maxConcurrent: num(process.env.MAX_CONCURRENT_JOBS, 2),
  },

  storageDir: path.resolve(process.env.STORAGE_DIR || path.join(__dirname, "..", "..", "storage")),
};

export type Env = typeof env;
