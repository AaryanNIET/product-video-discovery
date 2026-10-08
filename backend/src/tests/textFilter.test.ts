import { scoreTextMatch } from "../services/search/textFilter";
import { toNormalized } from "../services/search/normalize";
import { ProductIdentity } from "../types";

const identity: ProductIdentity = {
  brand: "Nova",
  productName: "Trail Runner X1",
  modelNumber: "unknown",
  sku: "unknown",
  category: "sneakers",
  color: "blue",
  imageUrl: null,
  visualFeatures: ["mesh upper", "orange sole"],
  searchQueries: [],
  negativeTerms: ["kids edition"],
};

test("scores a strong match highly", () => {
  const c = toNormalized({
    platform: "instagram",
    externalId: "1",
    url: "u",
    caption: "Unboxing the Nova Trail Runner X1 in blue, mesh upper looks great",
    metadata: {},
    sourceQuery: "q",
  });
  expect(scoreTextMatch(c, identity)).toBeGreaterThan(50);
});

test("scores an unrelated candidate low", () => {
  const c = toNormalized({
    platform: "instagram",
    externalId: "2",
    url: "u",
    caption: "My daily vlog about cooking pasta",
    metadata: {},
    sourceQuery: "q",
  });
  expect(scoreTextMatch(c, identity)).toBeLessThan(20);
});

test("penalizes negative terms", () => {
  const c = toNormalized({
    platform: "instagram",
    externalId: "3",
    url: "u",
    caption: "Nova Trail Runner X1 kids edition review",
    metadata: {},
    sourceQuery: "q",
  });
  const score = scoreTextMatch(c, identity);
  expect(score).toBeLessThan(70);
});
