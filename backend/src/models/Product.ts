import { Schema, model } from "mongoose";
import { ProductIdentity } from "../types";

/**
 * Cache of resolved + analysed products, keyed by normalised input (and the
 * uploaded image's hash). Re-searching the same link or image skips the page
 * fetch and the Gemini analysis call.
 */
export interface ProductCacheDoc {
  cacheKey: string;
  identity: ProductIdentity;
  createdAt: Date;
}

const ProductCacheSchema = new Schema<ProductCacheDoc>(
  {
    cacheKey: { type: String, required: true, unique: true },
    identity: { type: Schema.Types.Mixed, required: true },
  },
  { timestamps: true }
);

// Product pages change (price, images); re-analyse after 7 days.
ProductCacheSchema.index({ createdAt: 1 }, { expireAfterSeconds: 7 * 24 * 3600 });

export const ProductCacheModel = model<ProductCacheDoc>("ProductCache", ProductCacheSchema);
