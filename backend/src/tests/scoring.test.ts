import { describeReference, SCORE_RUBRIC, textFallbackScore, textRelevance, verdictForScore } from "../services/brain/matchScorer";
import { heuristicPlan, termsForRound, toHashtag } from "../services/brain/productAnalysis";
import { addRelatedHashtags, explainShortfall, rankAccepted } from "../services/pipeline/searchPipeline";
import { ProductIdentity, SourceSummary, VideoCandidate } from "../types";

const identity: ProductIdentity = {
  title: "Stanley Quencher H2.0 FlowState Tumbler 40oz",
  description: "",
  sourceType: "url",
  sourceUrl: null,
  imageSource: "page",
  imageId: null,
  imageUrl: null,
  analysisMode: "vision",
  attributes: {
    productType: "tumbler",
    brand: "Stanley",
    colours: ["rose quartz"],
    printsOrGraphics: [],
    logos: ["Stanley bear logo"],
    textOnProduct: ["STANLEY"],
    material: "stainless steel",
    shape: "tapered cup with handle",
    distinctiveFeatures: ["FlowState lid", "straw"],
    summary: "Pink 40oz Stanley Quencher tumbler with handle and straw lid",
  },
  searchPlan: { instagramHashtags: [], metaKeywords: [], tiktokKeywords: [] },
};

const vid = (id: string, extra: Partial<VideoCandidate> = {}): VideoCandidate => ({
  key: `instagram:${id}`,
  platform: "instagram",
  externalId: id,
  url: "u",
  sourceQuery: "q",
  ...extra,
});

describe("score rubric", () => {
  test("maps score bands to verdicts", () => {
    expect(verdictForScore(95)).toBe("exact");
    expect(verdictForScore(90)).toBe("exact");
    expect(verdictForScore(75)).toBe("very_close");
    expect(verdictForScore(50)).toBe("same_category");
    expect(verdictForScore(10)).toBe("different");
    expect(verdictForScore(0)).toBe("unclear");
  });
  test("bands are ordered high to low with no gaps", () => {
    const mins = SCORE_RUBRIC.map((b) => b.min);
    expect([...mins].sort((a, b) => b - a)).toEqual(mins);
  });
});

describe("text relevance and fallback", () => {
  test("a caption naming brand and product scores high", () => {
    expect(textRelevance(vid("1", { caption: "My new Stanley Quencher H2.0 tumbler in rose quartz" }), identity)).toBeGreaterThan(60);
  });
  test("an unrelated caption scores low", () => {
    expect(textRelevance(vid("2", { caption: "Morning pasta recipe" }), identity)).toBeLessThan(15);
  });
  test("fallback is labelled and can never claim an exact match", () => {
    const r = textFallbackScore(vid("3", { caption: "Stanley Quencher H2.0 FlowState tumbler 40oz rose quartz tumbler" }), identity);
    expect(r.method).toBe("text-fallback");
    expect(r.score).toBeLessThanOrEqual(75);
    expect(r.verdict).not.toBe("exact");
    expect(r.reason).toMatch(/not visually verified/);
  });
});

describe("ranking", () => {
  test("orders by match score; engagement only breaks ties", () => {
    const ranked = rankAccepted([
      vid("a", { match: { score: 80, verdict: "very_close", reason: "", matched: [], mismatched: [], method: "vision" }, engagement: 1_000_000 }),
      vid("b", { match: { score: 95, verdict: "exact", reason: "", matched: [], mismatched: [], method: "vision" }, engagement: 10 }),
      vid("c", { match: { score: 80, verdict: "very_close", reason: "", matched: [], mismatched: [], method: "vision" }, engagement: 5 }),
    ]);
    expect(ranked.map((c) => c.externalId)).toEqual(["b", "a", "c"]);
  });
});

describe("query planning", () => {
  test("hashtags are lowercase alphanumerics", () => {
    expect(toHashtag("Stanley Quencher H2.0!")).toBe("stanleyquencherh20");
  });
  test("heuristic plan produces specific terms first", () => {
    const plan = heuristicPlan("Stanley Quencher H2.0 Tumbler", "Stanley", "tumbler");
    expect(plan.instagramHashtags[0]).toBe("stanleyquencherh20tumbler");
    expect(plan.metaKeywords[0]).toBe("stanley quencher h2.0 tumbler");
  });
  test("each round takes the next slice of terms", () => {
    const t = ["a", "b", "c", "d", "e"];
    expect(termsForRound(t, 0, 2)).toEqual(["a", "b"]);
    expect(termsForRound(t, 2, 2)).toEqual(["e"]);
    expect(termsForRound(t, 3, 2)).toEqual([]);
  });
  test("reference description includes the detected attributes", () => {
    const d = describeReference(identity);
    expect(d).toContain("Brand: Stanley");
    expect(d).toContain("Text on product: STANLEY");
  });
});

test("related hashtags from verified videos are queued for the next round", () => {
  const plan = { instagramHashtags: ["a1a1", "b2b2", "c3c3", "d4d4", "e5e5"] };
  const verified = [
    vid("1", { caption: "love it #stanleypink #fyp #cupaesthetic" }),
    vid("2", { caption: "obsessed #stanleypink #cupaesthetic" }),
    vid("3", { caption: "#stanleypink" }),
  ];
  addRelatedHashtags(plan, verified, 0);
  expect(plan.instagramHashtags.slice(4, 6)).toEqual(["stanleypink", "cupaesthetic"]);
  expect(plan.instagramHashtags).not.toContain("fyp"); // generic tags are ignored
});

test("shortfall message explains every stage", () => {
  const s: SourceSummary = {
    platform: "meta_ads",
    enabled: true,
    status: "partial",
    accepted: [vid("1")],
    belowThreshold: [vid("2"), vid("3")],
    previouslySeen: [],
    stats: { fetched: 50, duplicates: 7, previouslySeen: 4, scored: 39, rounds: 3 },
    queriesUsed: [],
  };
  const msg = explainShortfall(s);
  expect(msg).toContain("1 of 20");
  expect(msg).toContain("7 duplicates");
  expect(msg).toContain("4 already shown");
});
