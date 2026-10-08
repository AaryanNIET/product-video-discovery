import OpenAI from "openai";
import { env } from "../../config/env";
import { logger } from "../../utils/logger";
import { withRetry } from "../../utils/retry";
import { NormalizedCandidate, ProductIdentity, VerificationResult } from "../../types";

const client = env.openaiApiKey ? new OpenAI({ apiKey: env.openaiApiKey }) : null;

const SYSTEM_PROMPT = `You compare a reference product image against a candidate video thumbnail and decide
whether the candidate shows the SAME physical product (not just a similar one). Respond with STRICT JSON only:
{
  "sameProduct": boolean,
  "confidence": number,    // 0-100
  "brandMatch": boolean,
  "modelMatch": boolean,
  "visualMatch": number,   // 0-100, visual similarity
  "evidence": string[]     // 2-4 short, concrete observations (no chain-of-thought, just conclusions)
}
Be conservative: if the product category, color, or visible text/logo does not clearly match, say sameProduct=false.`;

/**
 * Compares a reference product image to a candidate's thumbnail (and, where a
 * future video-frame extraction step supplies them, representative frames).
 * Falls back to a deterministic text/metadata-driven heuristic when no
 * OPENAI_API_KEY is configured, so visual verification still runs end-to-end
 * in mock mode.
 */
export async function verifyCandidate(
  candidate: NormalizedCandidate,
  identity: ProductIdentity
): Promise<VerificationResult> {
  if (!client || !identity.imageUrl || !candidate.thumbnailUrl) {
    return heuristicVerification(candidate, identity);
  }

  try {
    const completion = await withRetry(
      () =>
        client.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            {
              role: "user",
              content: [
                { type: "text", text: `Reference product: ${identity.brand} ${identity.productName}` },
                { type: "image_url", image_url: { url: identity.imageUrl! } },
                { type: "text", text: "Candidate thumbnail:" },
                { type: "image_url", image_url: { url: candidate.thumbnailUrl! } },
              ] as any,
            },
          ],
          temperature: 0,
          response_format: { type: "json_object" },
        }),
      { retries: 1, timeoutMs: 15000 }
    );

    const parsed = JSON.parse(completion.choices[0]?.message?.content || "{}");
    return {
      sameProduct: Boolean(parsed.sameProduct),
      confidence: clamp(Number(parsed.confidence) || 0),
      brandMatch: Boolean(parsed.brandMatch),
      modelMatch: Boolean(parsed.modelMatch),
      visualMatch: clamp(Number(parsed.visualMatch) || 0),
      evidence: Array.isArray(parsed.evidence) ? parsed.evidence.slice(0, 4) : [],
    };
  } catch (err) {
    logger.warn("AI visual verification failed, falling back to heuristic", {
      error: (err as Error).message,
    });
    return heuristicVerification(candidate, identity);
  }
}

function clamp(n: number): number {
  return Math.max(0, Math.min(100, n));
}

/**
 * Deterministic stand-in used in mock mode / on AI failure: derives a plausible
 * verification result from the candidate's text score and the mock "isOffTopic"
 * flag, so the pipeline's filtering behaviour is still exercised realistically.
 */
function heuristicVerification(candidate: NormalizedCandidate, identity: ProductIdentity): VerificationResult {
  const isOffTopic = Boolean((candidate.metadata as any)?.isOffTopic);
  const textScore = candidate.textScore ?? 0;

  const visualMatch = isOffTopic ? Math.max(5, 20 - Math.round(textScore / 10)) : Math.min(95, 55 + Math.round(textScore / 2));
  const confidence = isOffTopic ? Math.max(5, visualMatch - 10) : Math.min(92, visualMatch + 5);
  const brandMatch = !isOffTopic && identity.brand !== "unknown";
  const sameProduct = !isOffTopic && confidence >= env.verificationMinConfidence;

  return {
    sameProduct,
    confidence,
    brandMatch,
    modelMatch: sameProduct,
    visualMatch,
    evidence: isOffTopic
      ? ["Caption/category does not match the reference product", "Low text-match score"]
      : ["Caption keywords align with reference product", "No conflicting category signals detected"],
  };
}
