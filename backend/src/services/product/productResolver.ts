import axios from "axios";
import * as cheerio from "cheerio";
import { ProductIdentity } from "../../types";
import { logger } from "../../utils/logger";
import { withRetry } from "../../utils/retry";
import { analyzeProductImage } from "./aiProductAnalysis";
import { generateSearchQueries } from "../search/queryGenerator";

const BLOCKED_HOST_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^0\.0\.0\.0$/,
  /^10\./,
  /^192\.168\./,
  /^169\.254\./,
  /^::1$/,
];

export class InvalidUrlError extends Error {}

function assertSafeUrl(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new InvalidUrlError("Could not parse URL");
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new InvalidUrlError("Only http/https URLs are allowed");
  }
  if (BLOCKED_HOST_PATTERNS.some((re) => re.test(url.hostname))) {
    throw new InvalidUrlError("Refusing to fetch internal/private network addresses");
  }
  return url;
}

function isLikelyUrl(input: string): boolean {
  return /^https?:\/\//i.test(input.trim());
}

/** Extract product info from a product page using common meta tags + JSON-LD, falling back to heuristics. */
async function resolveFromUrl(rawUrl: string): Promise<Partial<ProductIdentity> & { sourceTitle: string }> {
  const url = assertSafeUrl(rawUrl);

  const html = await withRetry(
    async () => {
      const res = await axios.get(url.toString(), {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; ProductDiscoveryBot/1.0)" },
        maxRedirects: 5,
        validateStatus: (s) => s < 500,
      });
      if (res.status >= 400) throw new Error(`Page fetch failed with status ${res.status}`);
      return res.data as string;
    },
    { retries: 2, timeoutMs: 10000 }
  );

  const $ = cheerio.load(html);

  const ogTitle = $('meta[property="og:title"]').attr("content");
  const ogImage = $('meta[property="og:image"]').attr("content");
  const ogDescription = $('meta[property="og:description"]').attr("content");
  const metaDescription = $('meta[name="description"]').attr("content");
  const title = ogTitle || $("title").first().text() || $("h1").first().text();

  // Try to find JSON-LD Product schema for richer data (brand, sku, color).
  let jsonLdProduct: any = null;
  $('script[type="application/ld+json"]').each((_, el) => {
    if (jsonLdProduct) return;
    try {
      const data = JSON.parse($(el).contents().text());
      const items = Array.isArray(data) ? data : [data];
      const found = items.find((d) => d && (d["@type"] === "Product" || (Array.isArray(d["@type"]) && d["@type"].includes("Product"))));
      if (found) jsonLdProduct = found;
    } catch {
      // ignore malformed JSON-LD
    }
  });

  const brand =
    (typeof jsonLdProduct?.brand === "string" ? jsonLdProduct.brand : jsonLdProduct?.brand?.name) || "unknown";
  const sku = jsonLdProduct?.sku || jsonLdProduct?.mpn || "unknown";
  const color = jsonLdProduct?.color || "unknown";
  const image =
    ogImage ||
    (Array.isArray(jsonLdProduct?.image) ? jsonLdProduct.image[0] : jsonLdProduct?.image) ||
    null;

  return {
    sourceTitle: (title || "").trim(),
    brand,
    productName: (title || "").trim() || "unknown",
    sku,
    color,
    imageUrl: image,
    category: jsonLdProduct?.category || "unknown",
    visualFeatures: [],
    negativeTerms: [],
    searchQueries: [],
  };
}

/**
 * Resolve a product by free-text name. We don't have an authorized product-lookup
 * API wired in by default, so this builds a best-effort identity directly from the
 * query and marks unresolved attributes as "unknown" rather than hallucinating them.
 * Swap in a real product-search API (e.g. a retailer catalog API) here when available.
 */
async function resolveFromName(name: string): Promise<Partial<ProductIdentity> & { sourceTitle: string }> {
  return {
    sourceTitle: name,
    brand: "unknown",
    productName: name,
    sku: "unknown",
    color: "unknown",
    imageUrl: null,
    category: "unknown",
    visualFeatures: [],
    negativeTerms: [],
    searchQueries: [],
  };
}

export async function resolveProduct(input: string): Promise<{ identity: ProductIdentity; sourceType: "name" | "url" }> {
  const sourceType = isLikelyUrl(input) ? "url" : "name";

  logger.info("Resolving product", { sourceType, input });

  const base = sourceType === "url" ? await resolveFromUrl(input) : await resolveFromName(input);

  // AI visual analysis of the reference image, if we have one.
  let visualFeatures: string[] = [];
  let aiBrand = base.brand;
  let aiCategory = base.category;
  let aiColor = base.color;

  if (base.imageUrl) {
    try {
      const analysis = await analyzeProductImage(base.imageUrl, base.sourceTitle);
      visualFeatures = analysis.visualFeatures;
      aiBrand = analysis.brand !== "unknown" ? analysis.brand : base.brand;
      aiCategory = analysis.category !== "unknown" ? analysis.category : base.category;
      aiColor = analysis.color !== "unknown" ? analysis.color : base.color;
    } catch (err) {
      logger.warn("AI product image analysis failed, continuing without it", {
        error: (err as Error).message,
      });
    }
  }

  const identity: ProductIdentity = {
    brand: aiBrand || "unknown",
    productName: base.productName || base.sourceTitle || "unknown",
    modelNumber: "unknown",
    sku: base.sku || "unknown",
    category: aiCategory || "unknown",
    color: aiColor || "unknown",
    imageUrl: base.imageUrl || null,
    visualFeatures,
    negativeTerms: [],
    searchQueries: [],
  };

  identity.searchQueries = generateSearchQueries(identity);

  return { identity, sourceType };
}
