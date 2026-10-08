import dotenv from "dotenv";
dotenv.config();

function num(val: string | undefined, fallback: number): number {
  if (!val) return fallback;
  const n = Number(val);
  return Number.isFinite(n) ? n : fallback;
}

export const env = {
  port: num(process.env.PORT, 4000),
  nodeEnv: process.env.NODE_ENV || "development",
  clientOrigin: process.env.CLIENT_ORIGIN || "http://localhost:5173",
  mongodbUri: process.env.MONGODB_URI || "mongodb://localhost:27017/product-video-discovery",
  providerMode: (process.env.PROVIDER_MODE || "mock") as "mock" | "live",
  openaiApiKey: process.env.OPENAI_API_KEY || "",
  instagram: {
    accessToken: process.env.INSTAGRAM_ACCESS_TOKEN || "",
    apiVersion: process.env.INSTAGRAM_GRAPH_API_VERSION || "v20.0",
  },
  metaAds: {
    accessToken: process.env.META_AD_LIBRARY_ACCESS_TOKEN || "",
    apiVersion: process.env.META_AD_LIBRARY_API_VERSION || "v20.0",
  },
  rankWeights: {
    text: num(process.env.RANK_WEIGHT_TEXT, 0.3),
    visual: num(process.env.RANK_WEIGHT_VISUAL, 0.5),
    metadata: num(process.env.RANK_WEIGHT_METADATA, 0.2),
  },
  verificationMinConfidence: num(process.env.VERIFICATION_MIN_CONFIDENCE, 55),
};
