import { MatchResult, MatchVerdict, ProductIdentity, VideoCandidate } from "../../types";
import { generateJson, imagePart, isGeminiConfigured, GeminiPart } from "./gemini";
import { keywordsOf } from "./productAnalysis";
import { env } from "../../config/env";
import { logger } from "../../utils/logger";

/**
 * The scoring rubric is the contract for what a match score means. It is shared
 * by the prompt, the README and the UI legend, so a "72" always means the same thing.
 */
export const SCORE_RUBRIC = [
  { min: 90, verdict: "exact", label: "Exact product", rule: "Same product: logo, print/graphic, colours, shape and on-product text all match where visible." },
  { min: 70, verdict: "very_close", label: "Very close match", rule: "Almost certainly the same product; small details hidden by angle, lighting, motion or packaging." },
  { min: 40, verdict: "same_category", label: "Same category only", rule: "Similar type or style, but a key detail differs (different print, colourway, logo or model) or cannot be confirmed." },
  { min: 1, verdict: "different", label: "Different product", rule: "A different product, or the reference product is not shown." },
] as const;

const SCORER_SYSTEM = `You verify whether short-video thumbnails show ONE EXACT product, not just something in the same category.
You get a REFERENCE (an image and/or a description with attributes) followed by numbered CANDIDATE thumbnails with their captions.

Score each candidate 0-100 with this rubric:
- 90-100 exact: same product; logo, print/graphic, colours, shape and on-product text match wherever visible.
- 70-89 very_close: almost certainly the same product; minor details hidden by angle, lighting, motion blur or packaging.
- 40-69 same_category: similar type/style but at least one key detail differs (print, colourway, logo, model, label layout) or cannot be confirmed.
- 1-39 different: a different product, or the reference product does not appear.
- Use verdict "unclear" (score <= 30) when the thumbnail is unreadable or shows no product at all (text card, face only, black frame).

Rules:
- Judge the IMAGE first. A caption naming the product can raise confidence only when the image is consistent with it; it can never lift a visually different product above 39.
- Different colourway or different print of the same product line is NOT exact: score it 40-69.
- People wearing/holding/using the product is fine; judge the product itself.
- "reason": one short phrase a shopper would understand, e.g. "same print and colour, worn by a model" or "same bottle shape but different label".
- "matched"/"mismatched": short attribute names (e.g. "logo", "colour", "print", "shape", "label text").
Return one result per candidate index.`;

const SCORER_SCHEMA = {
  type: "OBJECT",
  properties: {
    results: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          index: { type: "INTEGER" },
          score: { type: "INTEGER" },
          verdict: { type: "STRING", enum: ["exact", "very_close", "same_category", "different", "unclear"] },
          reason: { type: "STRING" },
          matched: { type: "ARRAY", items: { type: "STRING" } },
          mismatched: { type: "ARRAY", items: { type: "STRING" } },
        },
        required: ["index", "score", "verdict", "reason", "matched", "mismatched"],
      },
    },
  },
  required: ["results"],
};

export function verdictForScore(score: number): MatchVerdict {
  for (const band of SCORE_RUBRIC) if (score >= band.min) return band.verdict;
  return "unclear";
}

export function describeReference(identity: ProductIdentity): string {
  const a = identity.attributes;
  const line = (label: string, v: string | string[]) => {
    const s = Array.isArray(v) ? v.join(", ") : v;
    return s && s !== "unknown" ? `${label}: ${s}\n` : "";
  };
  return (
    `Product: ${identity.title}\n` +
    line("Summary", a.summary) +
    line("Type", a.productType) +
    line("Brand", a.brand) +
    line("Colours", a.colours) +
    line("Prints/graphics", a.printsOrGraphics) +
    line("Logos", a.logos) +
    line("Text on product", a.textOnProduct) +
    line("Material", a.material) +
    line("Shape", a.shape) +
    line("Distinctive features", a.distinctiveFeatures)
  );
}

export interface ScoreInput {
  candidate: VideoCandidate;
  image: Buffer | null;
}

/**
 * Step 3 of the brain: compare each candidate thumbnail with the reference and
 * return a 0-100 match score plus a human-readable reason. Candidates are sent
 * in small batches (one reference + N thumbnails per request), which cuts
 * Gemini calls ~N-fold and keeps the reference identical across the batch.
 */
export async function scoreCandidates(identity: ProductIdentity, reference: Buffer | null, inputs: ScoreInput[]): Promise<Map<string, MatchResult>> {
  const out = new Map<string, MatchResult>();
  const withImage = inputs.filter((i) => i.image);
  const withoutImage = inputs.filter((i) => !i.image);

  for (const i of withoutImage) {
    out.set(i.candidate.key, { score: 0, verdict: "unclear", reason: "No thumbnail available to verify", matched: [], mismatched: [], method: "vision" });
  }

  if (!isGeminiConfigured()) {
    for (const i of withImage) out.set(i.candidate.key, textFallbackScore(i.candidate, identity));
    return out;
  }

  const batches: ScoreInput[][] = [];
  for (let k = 0; k < withImage.length; k += env.gemini.batchSize) batches.push(withImage.slice(k, k + env.gemini.batchSize));

  await Promise.all(
    batches.map(async (batch) => {
      try {
        const results = await scoreBatch(identity, reference, batch);
        batch.forEach((item, idx) => {
          out.set(item.candidate.key, results.get(idx) ?? textFallbackScore(item.candidate, identity, "Vision model skipped this item"));
        });
      } catch (err) {
        logger.warn("Gemini scoring batch failed, using text fallback", { error: (err as Error).message });
        for (const item of batch) out.set(item.candidate.key, textFallbackScore(item.candidate, identity, "Vision check failed"));
      }
    })
  );
  return out;
}

async function scoreBatch(identity: ProductIdentity, reference: Buffer | null, batch: ScoreInput[]): Promise<Map<number, MatchResult>> {
  const parts: GeminiPart[] = [{ text: `REFERENCE\n${describeReference(identity)}` }];
  if (reference) parts.push({ text: "Reference product image:" }, imagePart(reference));
  else parts.push({ text: "(No reference image: judge against the description above. Be stricter: without an image, cap scores at 85 unless brand and on-product text are clearly readable.)" });

  batch.forEach((item, idx) => {
    const caption = (item.candidate.caption || "").replace(/\s+/g, " ").slice(0, 300);
    parts.push({ text: `CANDIDATE ${idx} (${item.candidate.platform}) caption: ${caption || "(none)"}` }, imagePart(item.image!));
  });

  const reply = await generateJson<{ results: any[] }>(parts, SCORER_SCHEMA, SCORER_SYSTEM);
  const map = new Map<number, MatchResult>();
  for (const r of reply.results || []) {
    const idx = Number(r.index);
    if (!Number.isInteger(idx) || idx < 0 || idx >= batch.length) continue;
    const score = Math.max(0, Math.min(100, Math.round(Number(r.score) || 0)));
    // Keep the verdict consistent with the number: the rubric is the source of truth.
    const verdict: MatchVerdict = r.verdict === "unclear" && score <= 30 ? "unclear" : verdictForScore(score);
    map.set(idx, {
      score,
      verdict,
      reason: String(r.reason || "").trim() || "No reason given",
      matched: Array.isArray(r.matched) ? r.matched.slice(0, 6).map(String) : [],
      mismatched: Array.isArray(r.mismatched) ? r.mismatched.slice(0, 6).map(String) : [],
      method: "vision",
    });
  }
  return map;
}

/** Cheap caption relevance (0-100). Used to decide which candidates get vision-checked first, never to discard. */
export function textRelevance(candidate: VideoCandidate, identity: ProductIdentity): number {
  const text = `${candidate.caption || ""} ${candidate.creator || ""}`;
  const hay = ` ${keywordsOf(text).join(" ")} `;
  // Hashtags glue words together (#stanleyquencher), so also look inside the squashed text.
  const squashed = text.toLowerCase().replace(/[^a-z0-9]/g, "");
  const has = (w: string) => hay.includes(` ${w} `) || (w.length > 3 && squashed.includes(w.replace(/[^a-z0-9]/g, "")));

  // Weighted over the signals we actually have (an unknown brand shouldn't cap the score).
  const a = identity.attributes;
  const signals: Array<[weight: number, hit: number]> = [];
  if (a.brand !== "unknown") signals.push([35, keywordsOf(a.brand).every(has) ? 1 : 0]);
  const titleWords = keywordsOf(identity.title);
  if (titleWords.length) signals.push([40, titleWords.filter(has).length / titleWords.length]);
  const extras = [a.productType, ...a.colours, ...a.printsOrGraphics, ...a.textOnProduct].filter((v) => v && v !== "unknown").flatMap(keywordsOf);
  if (extras.length) signals.push([25, Math.min(1, extras.filter(has).length / 3)]);
  const total = signals.reduce((n, [w]) => n + w, 0);
  return total ? Math.round((100 * signals.reduce((n, [w, hit]) => n + w * hit, 0)) / total) : 0;
}

/**
 * Used only when no vision model is available (no GEMINI_API_KEY, or the call
 * failed). It is clearly labelled in the UI and capped below "exact" because
 * captions alone cannot prove the video shows the exact product.
 */
export function textFallbackScore(candidate: VideoCandidate, identity: ProductIdentity, why = "No vision model configured"): MatchResult {
  const offTopic = Boolean((candidate.raw as any)?.isOffTopic);
  const rel = offTopic ? Math.min(15, textRelevance(candidate, identity)) : textRelevance(candidate, identity);
  const score = Math.min(75, rel);
  return {
    score,
    verdict: verdictForScore(score),
    reason: `${why}. Caption keyword overlap ${rel}%, not visually verified`,
    matched: rel > 30 ? ["caption keywords"] : [],
    mismatched: rel > 30 ? [] : ["caption does not mention the product"],
    method: "text-fallback",
  };
}
