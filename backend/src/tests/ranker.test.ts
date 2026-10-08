import { rankCandidates } from "../services/ranking/ranker";
import { toNormalized } from "../services/search/normalize";

test("ranks higher-confidence candidates first", () => {
  const low = { ...toNormalized({ platform: "instagram", externalId: "1", url: "u", metadata: {}, sourceQuery: "q" }), textScore: 20, verification: { sameProduct: true, confidence: 40, brandMatch: false, modelMatch: false, visualMatch: 30, evidence: [] } };
  const high = { ...toNormalized({ platform: "instagram", externalId: "2", url: "u", metadata: {}, sourceQuery: "q" }), textScore: 90, verification: { sameProduct: true, confidence: 95, brandMatch: true, modelMatch: true, visualMatch: 95, evidence: [] } };

  const ranked = rankCandidates([low, high]);
  expect(ranked[0].externalId).toBe("2");
});

test("weights sum influences ordering predictably", () => {
  const visualHeavy = { ...toNormalized({ platform: "instagram", externalId: "1", url: "u", metadata: {}, sourceQuery: "q" }), textScore: 10, verification: { sameProduct: true, confidence: 90, brandMatch: true, modelMatch: true, visualMatch: 90, evidence: [] } };
  const textHeavy = { ...toNormalized({ platform: "instagram", externalId: "2", url: "u", metadata: {}, sourceQuery: "q" }), textScore: 90, verification: { sameProduct: true, confidence: 50, brandMatch: false, modelMatch: false, visualMatch: 10, evidence: [] } };

  const ranked = rankCandidates([textHeavy, visualHeavy], { text: 0.3, visual: 0.5, metadata: 0.2 });
  // With default weights visual counts more, so visualHeavy should win.
  expect(ranked[0].externalId).toBe("1");
});
