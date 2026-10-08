import { Schema, model, Document, Types } from "mongoose";
import { JobStatus, ProgressStep } from "../types";

export interface DiscoveryJobDoc extends Document {
  jobId: string;
  product: Types.ObjectId;
  status: JobStatus;
  progress: ProgressStep[];
  instagramStatus: "ok" | "partial" | "failed" | "pending";
  metaAdsStatus: "ok" | "partial" | "failed" | "pending";
  instagramCount: number;
  metaAdsCount: number;
  error?: string;
  createdAt: Date;
  updatedAt: Date;
}

const DiscoveryJobSchema = new Schema<DiscoveryJobDoc>(
  {
    jobId: { type: String, required: true, unique: true, index: true },
    product: { type: Schema.Types.ObjectId, ref: "Product", required: true },
    status: {
      type: String,
      enum: ["pending", "processing", "partial_success", "completed", "failed"],
      default: "pending",
    },
    progress: { type: Schema.Types.Mixed, default: [] },
    instagramStatus: { type: String, default: "pending" },
    metaAdsStatus: { type: String, default: "pending" },
    instagramCount: { type: Number, default: 0 },
    metaAdsCount: { type: Number, default: 0 },
    error: { type: String },
  },
  { timestamps: true }
);

export const DiscoveryJobModel = model<DiscoveryJobDoc>("DiscoveryJob", DiscoveryJobSchema);
