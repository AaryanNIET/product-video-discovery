import { dedupeCandidates, filterPreviouslySeen } from "../services/search/dedupe";
import { toNormalized } from "../services/search/normalize";

function candidate(externalId: string, caption: string) {
  return toNormalized({
    platform: "instagram",
    externalId,
    url: `https://instagram.com/${externalId}`,
    caption,
    creator: "creator1",
    metadata: {},
    sourceQuery: "q",
  });
}

test("removes exact duplicate ids", () => {
  const a = candidate("1", "shoe review");
  const b = candidate("1", "shoe review");
  expect(dedupeCandidates([a, b])).toHaveLength(1);
});

test("removes near-duplicate (same creator + caption, different id)", () => {
  const a = candidate("1", "Check out these new sneakers!");
  const b = candidate("2", "Check out these new sneakers!");
  expect(dedupeCandidates([a, b])).toHaveLength(1);
});

test("filterPreviouslySeen removes ids seen in earlier searches", () => {
  const a = candidate("1", "a");
  const b = candidate("2", "b");
  const seen = new Set([a.id]);
  const result = filterPreviouslySeen([a, b], seen);
  expect(result.map((c) => c.id)).toEqual([b.id]);
});
