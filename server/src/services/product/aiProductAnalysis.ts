import OpenAI from "openai";
import { env } from "../../config/env";
import { logger } from "../../utils/logger";
import { withRetry } from "../../utils/retry";

export interface ImageAnalysis {
  brand: string;
  productName: string;
  category: string;
  color: string;
  visibleText: string[];
  visualFeatures: string[];
}

const client = env.openaiApiKey ? new OpenAI({ apiKey: env.openaiApiKey }) : null;

const SYSTEM_PROMPT = `You are a precise product-image analyst. Given a product photo, extract only what is
visually verifiable. Respond with STRICT JSON only, matching this shape and nothing else:
{
  "brand": string,            // "unknown" if not visibly identifiable
  "productName": string,      // short descriptive name, "unknown" if unclear
  "category": string,         // e.g. "sneakers", "protein bar", "unknown"
  "color": string,            // dominant color(s), "unknown" if unclear
  "visibleText": string[],    // any readable text/logo on the product
  "visualFeatures": string[]  // 3-8 distinctive, re-usable visual descriptors
}
Never invent brand/model details you cannot see. Use "unknown" rather than guessing.`;

/**
 * Calls a multimodal model to analyze the reference product image.
 * Falls back to a deterministic heuristic (derived from the product title) when
 * no OPENAI_API_KEY is configured, so the pipeline still runs end-to-end in
 * mock/dev mode without external credentials.
 */
export async function analyzeProductImage(imageUrl: string, titleHint: string): Promise<ImageAnalysis> {
  if (!client) {
    return heuristicAnalysis(titleHint);
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
                { type: "text", text: `Product title hint: ${titleHint || "unknown"}` },
                { type: "image_url", image_url: { url: imageUrl } },
              ] as any,
            },
          ],
          temperature: 0,
          response_format: { type: "json_object" },
        }),
      { retries: 2, timeoutMs: 15000 }
    );

    const raw = completion.choices[0]?.message?.content || "{}";
    const parsed = JSON.parse(raw);
    return {
      brand: parsed.brand || "unknown",
      productName: parsed.productName || "unknown",
      category: parsed.category || "unknown",
      color: parsed.color || "unknown",
      visibleText: Array.isArray(parsed.visibleText) ? parsed.visibleText : [],
      visualFeatures: Array.isArray(parsed.visualFeatures) ? parsed.visualFeatures : [],
    };
  } catch (err) {
    logger.warn("OpenAI image analysis failed, falling back to heuristic", {
      error: (err as Error).message,
    });
    return heuristicAnalysis(titleHint);
  }
}

function heuristicAnalysis(titleHint: string): ImageAnalysis {
  const tokens = (titleHint || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

  return {
    brand: "unknown",
    productName: titleHint || "unknown",
    category: "unknown",
    color: "unknown",
    visibleText: [],
    visualFeatures: tokens.slice(0, 6),
  };
}
