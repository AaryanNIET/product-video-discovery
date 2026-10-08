import { ProductAttributes, SearchPlan } from "../../types";
import { generateJson, imagePart, isGeminiConfigured, GeminiPart } from "./gemini";
import { logger } from "../../utils/logger";

const ANALYSIS_SYSTEM = `You are the image-analysis brain of a product video search engine.
Your job: describe the EXACT product so that later steps can tell it apart from other products in the same category.

Rules:
- Only report what is visible in the image (or, with no image, what the title/description states). Never invent brand names, text or features.
- Use "unknown" for single values you cannot determine and [] for empty lists.
- "distinctiveFeatures" must be the details that separate THIS product from look-alikes (exact print, logo placement, unique cut, cap shape, label layout...).
- "summary" is one sentence a person could use to recognise this exact product in a video frame.

Search terms (used to find short videos of this product):
- instagramHashtags: 10 hashtags WITHOUT "#", lowercase, no spaces, ordered from most specific (brand + product line) to broader (brand only, product type + key feature). These are how creators actually tag posts.
- metaKeywords: 6 short phrases an advertiser would put in ad copy for this product, most specific first (brand + product name first).
- tiktokKeywords: 6 search phrases for TikTok videos showing this product, most specific first.
- Never return generic terms alone (e.g. just "tshirt" or "chocolate") unless no brand or distinguishing detail exists.`;

const stringList = { type: "ARRAY", items: { type: "STRING" } };

const ANALYSIS_SCHEMA = {
  type: "OBJECT",
  properties: {
    productType: { type: "STRING" },
    brand: { type: "STRING" },
    colours: stringList,
    printsOrGraphics: stringList,
    logos: stringList,
    textOnProduct: stringList,
    material: { type: "STRING" },
    shape: { type: "STRING" },
    distinctiveFeatures: stringList,
    summary: { type: "STRING" },
    instagramHashtags: stringList,
    metaKeywords: stringList,
    tiktokKeywords: stringList,
  },
  required: [
    "productType", "brand", "colours", "printsOrGraphics", "logos", "textOnProduct", "material", "shape",
    "distinctiveFeatures", "summary", "instagramHashtags", "metaKeywords", "tiktokKeywords",
  ],
};

export interface AnalysisResult {
  attributes: ProductAttributes;
  searchPlan: SearchPlan;
  mode: "vision" | "text" | "heuristic";
  /** Set when Gemini is configured but the call failed (bad model, quota, outage). */
  brainError?: string;
}

/**
 * Step 1 of the brain: read the reference image (plus title/description hints)
 * and extract product type, colours, prints, logos, on-product text, material
 * and shape, then turn those into platform-specific search terms.
 */
export async function analyzeProduct(input: { title: string; description: string; image: Buffer | null }): Promise<AnalysisResult> {
  if (!isGeminiConfigured()) return heuristicAnalysis(input.title, input.description);

  const parts: GeminiPart[] = [
    { text: `Product title: ${input.title || "unknown"}\nProduct description: ${(input.description || "none").slice(0, 1500)}` },
  ];
  if (input.image) {
    parts.push({ text: "Reference product image:" }, imagePart(input.image));
  } else {
    parts.push({ text: "No image is available. Work from the title and description only, and keep visual fields to what they state." });
  }

  try {
    const r = await generateJson<any>(parts, ANALYSIS_SCHEMA, ANALYSIS_SYSTEM);
    return {
      attributes: {
        productType: clean(r.productType),
        brand: clean(r.brand),
        colours: list(r.colours),
        printsOrGraphics: list(r.printsOrGraphics),
        logos: list(r.logos),
        textOnProduct: list(r.textOnProduct),
        material: clean(r.material),
        shape: clean(r.shape),
        distinctiveFeatures: list(r.distinctiveFeatures),
        summary: clean(r.summary) === "unknown" ? input.title : r.summary.trim(),
      },
      searchPlan: mergePlan(
        {
          instagramHashtags: list(r.instagramHashtags).map(toHashtag).filter(Boolean),
          metaKeywords: list(r.metaKeywords),
          tiktokKeywords: list(r.tiktokKeywords),
        },
        heuristicPlan(input.title, clean(r.brand), clean(r.productType))
      ),
      mode: input.image ? "vision" : "text",
    };
  } catch (err) {
    logger.warn("Gemini product analysis failed", { error: (err as Error).message });
    return { ...heuristicAnalysis(input.title, input.description), brainError: (err as Error).message };
  }
}

function clean(v: unknown): string {
  const s = typeof v === "string" ? v.trim() : "";
  return s && s.toLowerCase() !== "none" ? s : "unknown";
}

function list(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return [...new Set(v.map((x) => String(x).trim()).filter((x) => x && x.toLowerCase() !== "unknown"))];
}

export function toHashtag(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]/g, "");
}

const STOPWORDS = new Set(["the", "a", "an", "and", "or", "for", "with", "of", "in", "on", "to", "by", "new", "buy", "online", "shop", "sale", "best"]);

export function keywordsOf(text: string): string[] {
  // Dots and hyphens survive inside tokens so model numbers like "H2.0" or "X-1" stay intact.
  return (text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s.-]/g, " ")
    .split(/\s+/)
    .map((w) => w.replace(/^[.-]+|[.-]+$/g, ""))
    .filter((w) => w.length > 1 && !STOPWORDS.has(w));
}

/** Deterministic search terms from the title; also used to pad AI plans that come back short. */
export function heuristicPlan(title: string, brand = "unknown", productType = "unknown"): SearchPlan {
  const words = keywordsOf(title).slice(0, 6);
  const name = words.join(" ");
  const b = brand !== "unknown" ? brand.toLowerCase() : "";
  const t = productType !== "unknown" ? productType.toLowerCase() : "";

  const phrases = [name, b && t ? `${b} ${t}` : "", words.slice(0, 3).join(" "), b, t && words[0] ? `${words[0]} ${t}` : ""].filter(Boolean);
  const tags = [
    toHashtag(name),
    toHashtag(words.slice(0, 3).join("")),
    toHashtag(words.slice(0, 2).join("")),
    b ? toHashtag(b) : "",
    b && t ? toHashtag(b + t) : "",
    ...words.filter((w) => w.length > 3).map(toHashtag),
  ].filter((t) => t.length > 2);

  return {
    instagramHashtags: [...new Set(tags)],
    metaKeywords: [...new Set(phrases)],
    tiktokKeywords: [...new Set(phrases)],
  };
}

function mergePlan(primary: SearchPlan, fallback: SearchPlan): SearchPlan {
  const merge = (a: string[], b: string[], max: number) => [...new Set([...a, ...b].filter(Boolean))].slice(0, max);
  return {
    instagramHashtags: merge(primary.instagramHashtags, fallback.instagramHashtags, 14),
    metaKeywords: merge(primary.metaKeywords, fallback.metaKeywords, 10),
    tiktokKeywords: merge(primary.tiktokKeywords, fallback.tiktokKeywords, 10),
  };
}

function heuristicAnalysis(title: string, description: string): AnalysisResult {
  return {
    attributes: {
      productType: "unknown",
      brand: "unknown",
      colours: [],
      printsOrGraphics: [],
      logos: [],
      textOnProduct: [],
      material: "unknown",
      shape: "unknown",
      distinctiveFeatures: keywordsOf(`${title} ${description}`).slice(0, 6),
      summary: title,
    },
    searchPlan: heuristicPlan(title),
    mode: "heuristic",
  };
}

/** Splits an ordered term list into the slice used by a given search round (round 0 = most specific). */
export function termsForRound(terms: string[], round: number, perRound: number): string[] {
  return terms.slice(round * perRound, (round + 1) * perRound);
}
