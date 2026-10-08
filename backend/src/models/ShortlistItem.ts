import { Schema, model } from "mongoose";

export interface ShortlistItemDoc {
  key: string;
  platform: string;
  url: string;
  thumbId?: string;
  caption?: string;
  creator?: string;
  score?: number;
  reason?: string;
  productTitle?: string;
  jobId?: string;
  createdAt: Date;
}

const ShortlistItemSchema = new Schema<ShortlistItemDoc>(
  {
    key: { type: String, required: true, unique: true },
    platform: { type: String, required: true },
    url: { type: String, required: true },
    thumbId: String,
    caption: String,
    creator: String,
    score: Number,
    reason: String,
    productTitle: String,
    jobId: String,
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

export const ShortlistItemModel = model<ShortlistItemDoc>("ShortlistItem", ShortlistItemSchema);
