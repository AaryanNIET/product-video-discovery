import { Schema, model, Document, Types } from "mongoose";
import { Platform, VerificationResult } from "../types";

export interface VideoCandidateDoc extends Document {
  job: Types.ObjectId;
  product: Types.ObjectId;
  externalId: string;
  platform: Platform;
  url: string;
  thumbnailUrl?: string;
  title?: string;
  caption?: string;
  creator?: string;
  metadata: Record<string, unknown>;
  sourceQuery: string;
  textScore?: number;
  visualScore?: number;
  metadataScore?: number;
  finalScore?: number;
  verification?: VerificationResult;
  retrievedAt: Date;
}

const VideoCandidateSchema = new Schema<VideoCandidateDoc>(
  {
    job: { type: Schema.Types.ObjectId, ref: "DiscoveryJob", required: true },
    product: { type: Schema.Types.ObjectId, ref: "Product", required: true },
    externalId: { type: String, required: true },
    platform: { type: String, enum: ["instagram", "meta_ads"], required: true },
    url: { type: String, required: true },
    thumbnailUrl: String,
    title: String,
    caption: String,
    creator: String,
    metadata: { type: Schema.Types.Mixed, default: {} },
    sourceQuery: { type: String, required: true },
    textScore: Number,
    visualScore: Number,
    metadataScore: Number,
    finalScore: Number,
    verification: { type: Schema.Types.Mixed },
    retrievedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

// Provenance + dedupe support: one external video per platform is unique.
VideoCandidateSchema.index({ platform: 1, externalId: 1 }, { unique: false });

export const VideoCandidateModel = model<VideoCandidateDoc>("VideoCandidate", VideoCandidateSchema);
