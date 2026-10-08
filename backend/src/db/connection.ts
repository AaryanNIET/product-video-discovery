import mongoose from "mongoose";
import { env } from "../config/env";
import { logger } from "../utils/logger";

// Fail fast instead of queueing queries for 10s when MongoDB is down; every
// caller checks isDbReady() and falls back to in-memory state.
mongoose.set("bufferCommands", false);

export const isDbReady = () => mongoose.connection.readyState === 1;

export async function connectDb(): Promise<boolean> {
  try {
    await mongoose.connect(env.mongodbUri, { serverSelectionTimeoutMS: 8000 });
    logger.info("Connected to MongoDB");
    return true;
  } catch (err) {
    logger.error("MongoDB connection failed - running with in-memory storage (history and seen-videos reset on restart)", {
      error: (err as Error).message,
    });
    return false;
  }
}
