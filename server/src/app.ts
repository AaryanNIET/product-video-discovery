import express from "express";
import cors from "cors";
import morgan from "morgan";
import { env } from "./config/env";
import discoveryRoutes from "./routes/discoveryRoutes";

export const app = express();

app.use(cors({ origin: env.clientOrigin }));
app.use(express.json({ limit: "1mb" }));
app.use(morgan(env.nodeEnv === "development" ? "dev" : "combined"));

app.get("/api/health", (_req, res) => res.json({ ok: true, providerMode: env.providerMode }));
app.use("/api", discoveryRoutes);

// Structured error handler (never leaks secrets / stack traces to the client).
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(JSON.stringify({ level: "error", message: err?.message || "Unhandled error" }));
  res.status(err?.status || 500).json({ error: "internal_error", message: "Something went wrong" });
});
