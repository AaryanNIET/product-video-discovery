import express from "express";
import cors from "cors";
import morgan from "morgan";
import { env } from "./config/env";
import routes from "./routes";
import { isDbReady } from "./db/connection";
import { logger } from "./utils/logger";
import { activeGeminiModel } from "./services/brain/gemini";

export const app = express();

app.disable("x-powered-by");
app.use(cors({ origin: env.clientOrigin.split(",").map((s) => s.trim()) }));
app.use(express.json({ limit: "10mb" })); // room for one base64 product image
app.use(morgan(env.nodeEnv === "development" ? "dev" : "combined", { skip: (req) => req.url.startsWith("/api/media") }));

app.get("/api/health", (_req, res) =>
  res.json({
    ok: true,
    providerMode: env.providerMode,
    database: isDbReady() ? "connected" : "unavailable (in-memory)",
    scraper: env.providerMode === "mock" ? "mock data" : env.apify.token ? "apify" : "missing APIFY_TOKEN",
    vision: env.gemini.apiKey ? (activeGeminiModel() ? `gemini (${activeGeminiModel()})` : "gemini (all models out of quota)") : "missing GEMINI_API_KEY (caption-only fallback)",
    tiktokAvailable: env.tiktok.enabled,
    matchThreshold: env.matching.threshold,
    minimumPerSource: env.matching.perSourceMinimum,
  })
);
app.use("/api", routes);

app.use("/api", (_req, res) => res.status(404).json({ error: "not_found", message: "Unknown API route" }));

// Structured error handler: logs details server-side, never leaks stack traces or secrets.
app.use((err: any, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const status = Number(err?.status || err?.statusCode) || 500;
  logger.error("Request failed", { method: req.method, path: req.path, status, error: err?.message });
  if (err?.type === "entity.too.large") return res.status(413).json({ error: "too_large", message: "The uploaded image is too large (max 6 MB)." });
  res.status(status).json({ error: status >= 500 ? "internal_error" : "bad_request", message: status >= 500 ? "Something went wrong on the server." : err.message });
});
