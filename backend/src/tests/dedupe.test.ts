import sharp from "sharp";
import { captionFingerprint, dedupeCandidates, isInformativePhash, mediaKeyOf } from "../services/dedupe/dedupe";
import { dHash, hammingDistance } from "../services/media/imageStore";
import { VideoCandidate } from "../types";

function video(id: string, extra: Partial<VideoCandidate> = {}): VideoCandidate {
  return { key: `instagram:${id}`, platform: "instagram", externalId: id, url: `https://instagram.com/reel/${id}`, sourceQuery: "q", ...extra };
}

describe("dedupeCandidates (inside one result set)", () => {
  test("drops a repeated platform id", () => {
    const r = dedupeCandidates([video("1"), video("1")]);
    expect(r.unique).toHaveLength(1);
    expect(r.duplicates[0].reason).toBe("same id");
  });

  test("drops the same media file under a different id (signed query strings ignored)", () => {
    const a = video("1", { videoUrl: "https://scontent.cdninstagram.com/v/t50/AQN_abcdef123456789.mp4?sig=aaa" });
    const b = video("2", { videoUrl: "https://scontent-lhr.cdninstagram.com/v/t50/AQN_abcdef123456789.mp4?sig=bbb" });
    const r = dedupeCandidates([a, b]);
    expect(r.unique.map((c) => c.key)).toEqual(["instagram:1"]);
    expect(r.duplicates[0].reason).toBe("same media file");
  });

  test("drops one Meta creative running under several ad ids", () => {
    const a: VideoCandidate = { ...video("10"), key: "meta_ads:10", platform: "meta_ads", groupId: "777" };
    const b: VideoCandidate = { ...video("11"), key: "meta_ads:11", platform: "meta_ads", groupId: "777" };
    expect(dedupeCandidates([a, b]).duplicates[0].reason).toBe("same ad creative");
  });

  test("drops reposts with the same caption from the same creator, ignoring hashtags and emoji", () => {
    const a = video("1", { creator: "shop", caption: "Our new Trail Runner X1 is finally here 🔥 #running #shoes" });
    const b = video("2", { creator: "shop", caption: "Our new trail runner x1 is finally here!! #newin" });
    expect(dedupeCandidates([a, b]).duplicates[0].reason).toBe("same caption and creator");
  });

  test("keeps the same caption from different creators (common ad copy is not a duplicate)", () => {
    const a = video("1", { creator: "alice", caption: "Unboxing the Trail Runner X1 in blue today" });
    const b = video("2", { creator: "bob", caption: "Unboxing the Trail Runner X1 in blue today" });
    expect(dedupeCandidates([a, b]).unique).toHaveLength(2);
  });

  test("drops visually identical thumbnails (perceptual hash within 5 bits)", () => {
    const a = video("1", { phash: "f0e1d2c3b4a59687" });
    const b = video("2", { phash: "f0e1d2c3b4a59686" }); // 1 bit different
    const c = video("3", { phash: "0f1e2d3c4b5a6978" }); // very different
    const r = dedupeCandidates([a, b, c]);
    expect(r.unique.map((x) => x.externalId)).toEqual(["1", "3"]);
    expect(r.duplicates[0].reason).toBe("visually identical thumbnail");
  });

  test("checks against videos already kept earlier in the search", () => {
    const r = dedupeCandidates([video("5")], [video("5")]);
    expect(r.unique).toHaveLength(0);
  });
});

describe("helpers", () => {
  test("short captions are not used as fingerprints", () => {
    expect(captionFingerprint("so cute!! #ad")).toBeNull();
  });
  test("mediaKeyOf ignores generic file names", () => {
    expect(mediaKeyOf({ videoUrl: "https://x.fbcdn.net/v/video.mp4" })).toBeUndefined();
  });
  test("blank-image hashes are not treated as informative", () => {
    expect(isInformativePhash("0000000000000000")).toBe(false);
    expect(isInformativePhash("ffffffffffffffff")).toBe(false);
    expect(isInformativePhash("f0e1d2c3b4a59687")).toBe(true);
  });
});

describe("dHash on real images", () => {
  const gradient = async (flip: boolean, width = 320) => {
    const w = width, h = 240;
    const px = Buffer.alloc(w * h * 3);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        // Smooth, photo-like content (real thumbnails have low-frequency structure).
        const v = flip ? 255 - Math.round((x / w) * 255) : Math.round(128 + 100 * Math.sin(x / 40) * Math.cos(y / 30));
        px.set([v, (v * 2) % 255, 255 - v], (y * w + x) * 3);
      }
    return sharp(px, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer();
  };

  test("a re-encoded, resized copy hashes within the near-duplicate distance", async () => {
    const original = await gradient(false);
    const reencoded = await sharp(original).resize(200).jpeg({ quality: 40 }).toBuffer();
    expect(hammingDistance(await dHash(original), await dHash(reencoded))).toBeLessThanOrEqual(5);
  });

  test("different images are far apart", async () => {
    expect(hammingDistance(await dHash(await gradient(false)), await dHash(await gradient(true)))).toBeGreaterThan(10);
  });
});
