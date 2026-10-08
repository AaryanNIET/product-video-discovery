import * as cheerio from "cheerio";
import { ProductIdentity } from "../../types";
import { logger } from "../../utils/logger";
import { safeFetch, UnsafeUrlError, FetchFailedError } from "../../utils/safeFetch";
import { analyzeProduct } from "../brain/productAnalysis";
import { downloadImage, loadReferenceImage, saveReferenceImage, sha1, toVisionJpeg } from "../media/imageStore";
import { ProductCacheModel } from "../../models/Product";
import { isDbReady } from "../../db/connection";

export class ProductPageError extends Error {
  status = 422;
}

export interface PageData {
  title: string;
  description: string;
  imageUrl: string | null;
}

export const isUrlInput = (s: string) => /^https?:\/\//i.test(s.trim());

const strip = (s?: string | null) => (s || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

function absolutize(src: string | undefined | null, base: string): string | null {
  if (!src) return null;
  try {
    return new URL(src.startsWith("//") ? `https:${src}` : src, base).toString();
  } catch {
    return null;
  }
}

/** Finds a schema.org Product in any JSON-LD block, including @graph arrays. */
function findJsonLdProduct($: cheerio.CheerioAPI): any {
  let found: any = null;
  $('script[type="application/ld+json"]').each((_, el) => {
    if (found) return;
    try {
      const data = JSON.parse($(el).contents().text());
      const stack = Array.isArray(data) ? [...data] : [data];
      while (stack.length && !found) {
        const node = stack.shift();
        if (!node || typeof node !== "object") continue;
        const type = node["@type"];
        if (type === "Product" || (Array.isArray(type) && type.includes("Product"))) found = node;
        if (Array.isArray(node["@graph"])) stack.push(...node["@graph"]);
      }
    } catch {
      /* ignore malformed JSON-LD */
    }
  });
  return found;
}

/** Shopify exposes clean product JSON at /products/<handle>.js on every store. */
async function tryShopify(pageUrl: string, html: string): Promise<PageData | null> {
  if (!/cdn\.shopify\.com|Shopify\.theme/i.test(html)) return null;
  const u = new URL(pageUrl);
  const m = u.pathname.match(/(.*\/products\/[^/?#]+)/);
  if (!m) return null;
  try {
    const res = await safeFetch(`${u.origin}${m[1]}.js`, { maxBytes: 2 * 1024 * 1024 });
    if (res.status >= 400) return null;
    const p = JSON.parse(res.body.toString("utf8"));
    return {
      title: [p.vendor, p.title].filter(Boolean).join(" ").trim(),
      description: strip(p.description).slice(0, 2000),
      imageUrl: absolutize(p.featured_image || p.images?.[0], pageUrl),
    };
  } catch {
    return null;
  }
}

/** Extracts title, description and main image from a product page HTML. */
export function extractFromHtml(html: string, pageUrl: string): PageData {
  const $ = cheerio.load(html);
  const ld = findJsonLdProduct($);
  const meta = (sel: string) => $(sel).attr("content")?.trim();

  // Amazon: the hi-res main image lives in data attributes, not og:image.
  let amazonImage: string | undefined = $("#landingImage").attr("data-old-hires") || $("#imgBlkFront").attr("data-old-hires");
  if (!amazonImage) {
    const dyn = $("#landingImage").attr("data-a-dynamic-image") || $("#imgBlkFront").attr("data-a-dynamic-image");
    try {
      amazonImage = dyn ? Object.keys(JSON.parse(dyn))[0] : undefined;
    } catch {
      /* ignore */
    }
  }
  const amazonBullets = $("#feature-bullets li").map((_, el) => $(el).text().trim()).get().join(". ");

  const ldImage = Array.isArray(ld?.image) ? ld.image[0] : typeof ld?.image === "object" ? ld?.image?.url : ld?.image;
  const ldBrand = typeof ld?.brand === "string" ? ld.brand : ld?.brand?.name;
  const rawTitle = strip($("#productTitle").text()) || ld?.name || meta('meta[property="og:title"]') || strip($("h1").first().text()) || strip($("title").first().text());
  const title = ldBrand && rawTitle && !rawTitle.toLowerCase().includes(String(ldBrand).toLowerCase()) ? `${ldBrand} ${rawTitle}` : rawTitle;

  return {
    title: strip(title).slice(0, 200),
    description: strip(ld?.description || amazonBullets || meta('meta[property="og:description"]') || meta('meta[name="description"]')).slice(0, 2000),
    imageUrl: absolutize(amazonImage || ldImage || meta('meta[property="og:image"]') || meta('meta[name="twitter:image"]'), pageUrl),
  };
}

export async function fetchProductPage(rawUrl: string): Promise<PageData> {
  let res;
  try {
    res = await safeFetch(rawUrl);
  } catch (err) {
    if (err instanceof UnsafeUrlError) throw err;
    throw new ProductPageError(`Could not open the product page (${(err as Error).message}). Try again, or upload the product image instead.`);
  }
  const html = res.body.toString("utf8");
  const blocked = res.status === 403 || res.status === 503 || /captcha|robot check|Type the characters you see/i.test(html.slice(0, 20000));
  if (blocked) {
    throw new ProductPageError(
      `The site blocked automated access (HTTP ${res.status}). Amazon and some large retailers do this. Upload a photo of the product, or paste its name, to search anyway.`
    );
  }
  if (res.status >= 400) throw new ProductPageError(`The product page returned HTTP ${res.status}.`);

  const data = (await tryShopify(res.url, html)) || extractFromHtml(html, res.url);
  if (!data.title) throw new ProductPageError("Could not find a product title on that page.");
  return data;
}

export interface ResolvedProduct {
  identity: ProductIdentity;
  /** Reference image prepared for the vision model; null when matching by description only. */
  reference: Buffer | null;
  cached: boolean;
}

const memoryCache = new Map<string, ProductIdentity>();

async function readCache(key: string): Promise<ProductIdentity | null> {
  if (memoryCache.has(key)) return memoryCache.get(key)!;
  if (!isDbReady()) return null;
  const doc = await ProductCacheModel.findOne({ cacheKey: key }).lean();
  return (doc?.identity as ProductIdentity) || null;
}

async function writeCache(key: string, identity: ProductIdentity) {
  memoryCache.set(key, identity);
  if (memoryCache.size > 200) memoryCache.delete(memoryCache.keys().next().value!);
  if (!isDbReady()) return;
  await ProductCacheModel.updateOne({ cacheKey: key }, { $set: { identity } }, { upsert: true }).catch((err) =>
    logger.warn("Could not cache product", { error: err.message })
  );
}

export type ResolveStep = "fetch_page" | "analyse_image";

/**
 * Turns the search input (name, link and/or uploaded image) into a product
 * identity: title, reference image, visual attributes and search terms.
 * Results are cached so the same link or image is never re-fetched or re-analysed.
 */
export async function resolveProduct(
  input: string,
  upload: Buffer | null,
  onStep: (step: ResolveStep, status: "active" | "done" | "skipped" | "error", detail?: string) => void
): Promise<ResolvedProduct> {
  const text = input.trim();
  const uploadHash = upload ? sha1(upload) : "";
  const cacheKey = sha1(`${text.toLowerCase()}|${uploadHash}`);

  const cached = await readCache(cacheKey);
  if (cached) {
    const ref = cached.imageId ? await loadReferenceImage(cached.imageId) : null;
    if (!cached.imageId || ref) {
      onStep("fetch_page", "done", "Loaded from cache");
      onStep("analyse_image", "done", "Loaded from cache");
      return { identity: cached, reference: ref ? await toVisionJpeg(ref, 640) : null, cached: true };
    }
  }

  let page: PageData = { title: text, description: "", imageUrl: null };
  const sourceType: ProductIdentity["sourceType"] = isUrlInput(text) ? "url" : text ? "name" : "image";

  if (sourceType === "url") {
    onStep("fetch_page", "active", new URL(text).hostname);
    page = await fetchProductPage(text);
    onStep("fetch_page", "done", page.title.slice(0, 80));
  } else {
    onStep("fetch_page", "skipped", sourceType === "name" ? "Product name search" : "Image-only search");
  }

  let imageBuffer: Buffer | null = upload;
  let imageSource: ProductIdentity["imageSource"] = upload ? "upload" : null;
  if (!imageBuffer && page.imageUrl) {
    try {
      imageBuffer = await downloadImage(page.imageUrl);
      imageSource = "page";
    } catch (err) {
      logger.warn("Could not download product image", { url: page.imageUrl, error: (err as Error).message });
    }
  }

  onStep("analyse_image", "active", imageBuffer ? "Reading product photo" : "No photo: analysing text only");
  const imageId = imageBuffer ? await saveReferenceImage(imageBuffer) : null;
  const analysisImage = imageBuffer ? await toVisionJpeg(imageBuffer, 768) : null;
  const analysis = await analyzeProduct({ title: page.title, description: page.description, image: analysisImage });

  const a = analysis.attributes;
  const fallbackTitle = [a.brand !== "unknown" ? a.brand : "", a.productType !== "unknown" ? a.productType : ""].join(" ").trim();
  const identity: ProductIdentity = {
    title: page.title || fallbackTitle || "Uploaded product",
    description: page.description,
    sourceType,
    sourceUrl: sourceType === "url" ? text : null,
    imageSource,
    imageId,
    imageUrl: page.imageUrl,
    attributes: analysis.attributes,
    searchPlan: analysis.searchPlan,
    analysisMode: analysis.mode,
  };
  onStep("analyse_image", "done", `${analysis.mode === "vision" ? "Vision" : analysis.mode === "text" ? "Text-only" : "Heuristic"} analysis`);

  // Heuristic results are not cached, so adding a GEMINI_API_KEY later takes effect immediately.
  if (analysis.mode !== "heuristic") await writeCache(cacheKey, identity);
  return { identity, reference: imageBuffer ? await toVisionJpeg(imageBuffer, 640) : null, cached: false };
}

export { FetchFailedError };
