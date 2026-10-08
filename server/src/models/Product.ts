import { Schema, model, Document } from "mongoose";
import { ProductIdentity } from "../types";

export interface ProductDoc extends Document, ProductIdentity {
  sourceType: "name" | "url";
  sourceInput: string;
  createdAt: Date;
}

const ProductSchema = new Schema<ProductDoc>(
  {
    brand: { type: String, default: "unknown" },
    productName: { type: String, required: true },
    modelNumber: { type: String, default: "unknown" },
    sku: { type: String, default: "unknown" },
    category: { type: String, default: "unknown" },
    color: { type: String, default: "unknown" },
    imageUrl: { type: String, default: null },
    visualFeatures: { type: [String], default: [] },
    searchQueries: { type: [String], default: [] },
    negativeTerms: { type: [String], default: [] },
    sourceType: { type: String, enum: ["name", "url"], required: true },
    sourceInput: { type: String, required: true },
  },
  { timestamps: true }
);

// Cache lookup: same source input should not be re-resolved every time.
ProductSchema.index({ sourceInput: 1 });

export const ProductModel = model<ProductDoc>("Product", ProductSchema);
