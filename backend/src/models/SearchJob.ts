import { Schema, model } from "mongoose";
import { JobStatus, ProductIdentity, ProgressStep, SourceSummary } from "../types";

export interface SearchJobDoc {
  jobId: string;
  input: string;
  hasUpload: boolean;
  includeTikTok: boolean;
  status: JobStatus;
  progress: ProgressStep[];
  product: ProductIdentity | null;
  sources: Record<string, SourceSummary>;
  error?: string;
  createdAt: Date;
  updatedAt: Date;
}

const SearchJobSchema = new Schema<SearchJobDoc>(
  {
    jobId: { type: String, required: true, unique: true },
    input: { type: String, default: "" },
    hasUpload: { type: Boolean, default: false },
    includeTikTok: { type: Boolean, default: false },
    status: { type: String, enum: ["queued", "running", "completed", "partial", "failed"], default: "queued" },
    progress: { type: Schema.Types.Mixed, default: [] },
    product: { type: Schema.Types.Mixed, default: null },
    sources: { type: Schema.Types.Mixed, default: {} },
    error: String,
  },
  { timestamps: true, minimize: false }
);

SearchJobSchema.index({ createdAt: -1 });

export const SearchJobModel = model<SearchJobDoc>("SearchJob", SearchJobSchema);
