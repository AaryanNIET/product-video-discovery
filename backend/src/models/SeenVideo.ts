import { Schema, model } from "mongoose";
import { Platform } from "../types";

/** One row per video ever returned, with the search that first returned it (uniqueness across searches). */
export interface SeenVideoDoc {
  key: string;
  platform: Platform;
  mediaKey?: string;
  phash?: string;
  jobId: string;
  createdAt: Date;
}

const SeenVideoSchema = new Schema<SeenVideoDoc>(
  {
    key: { type: String, required: true, unique: true },
    platform: { type: String, required: true },
    mediaKey: { type: String, index: true },
    phash: String,
    jobId: { type: String, required: true, index: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

export const SeenVideoModel = model<SeenVideoDoc>("SeenVideo", SeenVideoSchema);
