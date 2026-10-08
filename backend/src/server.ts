import mongoose from "mongoose";
import { app } from "./app";
import { env } from "./config/env";
import { logger } from "./utils/logger";

async function main() {
  try {
    await mongoose.connect(env.mongodbUri);
    logger.info("Connected to MongoDB");
  } catch (err) {
    logger.error("MongoDB connection failed - starting anyway (history/cache disabled)", {
      error: (err as Error).message,
    });
  }

  app.listen(env.port, () => {
    logger.info(`Server listening on port ${env.port}`, { providerMode: env.providerMode });
  });
}

main();
