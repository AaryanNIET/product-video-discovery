import { app } from "./app";
import { env } from "./config/env";
import { connectDb } from "./db/connection";
import { seenStore } from "./services/dedupe/seenStore";
import { logger } from "./utils/logger";

async function main() {
  if (await connectDb()) await seenStore.load().catch((err) => logger.warn("Could not load seen index", { error: err.message }));

  if (env.providerMode === "live" && !env.apify.token) logger.warn("APIFY_TOKEN is not set: Instagram/Meta/TikTok searches will fail. Set it or use PROVIDER_MODE=mock.");
  if (!env.gemini.apiKey) logger.warn("GEMINI_API_KEY is not set: match scores fall back to caption text only.");

  app.listen(env.port, () => {
    logger.info(`Server listening on port ${env.port}`, { providerMode: env.providerMode, geminiModel: env.gemini.apiKey ? env.gemini.model : null });
  });
}

main();
