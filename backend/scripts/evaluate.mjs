#!/usr/bin/env node
/**
 * Test-evidence runner (assignment deliverable #4).
 *
 * Runs each product through the real API exactly like the dashboard does,
 * then repeats the first search to prove the second run returns new videos.
 * Writes docs/test-results.md (readable report) and docs/test-results.json.
 *
 *   npm run evaluate                      # default product set
 *   npm run evaluate -- products.json     # custom list: [{ "label": "...", "input": "..." }]
 *
 * Requires the backend to be running (npm run dev) with APIFY_TOKEN and GEMINI_API_KEY set.
 */
import fs from "fs/promises";
import path from "path";

const API = process.env.API_URL || "http://localhost:4000/api";
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..", "..");

const DEFAULT_PRODUCTS = [
  { label: "Branded drinkware (name)", input: "Stanley Quencher H2.0 FlowState Tumbler 40 oz" },
  { label: "Footwear (Shopify link)", input: "https://www.allbirds.com/products/mens-tree-runners" },
  { label: "Apparel, generic (name)", input: "oversized graphic tee" },
  { label: "Food, generic (name)", input: "protein dark chocolate" },
  { label: "Skincare (Amazon link)", input: "https://www.amazon.com/dp/B00TTD9BRC" },
  { label: "Water bottle (name)", input: "Owala FreeSip insulated water bottle 24oz" },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(pathname, init) {
  const res = await fetch(API + pathname, { headers: { "Content-Type": "application/json" }, ...init });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.message || `HTTP ${res.status}`);
  return body;
}

async function runSearch(input) {
  // Rate limit is 6 searches/minute; wait and retry if we hit it.
  for (;;) {
    try {
      const { jobId } = await api("/search", { method: "POST", body: JSON.stringify({ input, includeTikTok: false }) });
      const started = Date.now();
      for (;;) {
        await sleep(3000);
        const job = await api(`/search/${jobId}`);
        if (["completed", "partial", "failed"].includes(job.status)) return { ...job, seconds: Math.round((Date.now() - started) / 1000) };
        if (Date.now() - started > 15 * 60_000) throw new Error("Timed out after 15 minutes");
      }
    } catch (err) {
      if (/Too many searches/.test(err.message)) {
        await sleep(30_000);
        continue;
      }
      throw err;
    }
  }
}

const SOURCES = [
  ["instagram", "Instagram"],
  ["meta_ads", "Meta Ads"],
];

function summarize(label, input, job) {
  const src = Object.fromEntries(
    SOURCES.map(([k]) => {
      const s = job.sources?.[k];
      return [k, s ? { status: s.status, verified: s.accepted.length, below: s.belowThreshold.length, ...s.stats, error: s.error || null } : null];
    })
  );
  const all = SOURCES.flatMap(([k]) => job.sources?.[k]?.accepted || []);
  const below = SOURCES.flatMap(([k]) => job.sources?.[k]?.belowThreshold || []);
  const pick = (c) => ({ platform: c.platform, score: c.match?.score, verdict: c.match?.verdict, reason: c.match?.reason, url: c.url, caption: (c.caption || "").slice(0, 100) });
  return {
    label,
    input,
    jobId: job.jobId,
    status: job.status,
    seconds: job.seconds,
    error: job.error || null,
    analysisMode: job.product?.analysisMode || null,
    detected: job.product
      ? {
          title: job.product.title,
          type: job.product.attributes.productType,
          brand: job.product.attributes.brand,
          colours: job.product.attributes.colours,
          text: job.product.attributes.textOnProduct,
          hashtags: job.product.searchPlan.instagramHashtags.slice(0, 5),
        }
      : null,
    sources: src,
    goodExamples: [...all].sort((a, b) => b.match.score - a.match.score).slice(0, 3).map(pick),
    // "Bad" = what the brain rejected: highest-scoring rejects show where the threshold bites.
    rejectedExamples: [...below].sort((a, b) => (b.match?.score ?? 0) - (a.match?.score ?? 0)).slice(0, 3).map(pick),
    acceptedKeys: all.map((c) => c.key),
  };
}

function markdown(results, repeat, threshold) {
  const lines = [];
  const d = new Date().toISOString().slice(0, 16).replace("T", " ");
  lines.push(`# Test results`, "", `Generated ${d} UTC by \`npm run evaluate\`. Match threshold: **${threshold}**. Minimum per source: **20**.`, "");
  lines.push("## Summary", "", "| # | Product | Input | Status | Instagram verified | Meta verified | Time |", "|---|---|---|---|---|---|---|");
  results.forEach((r, i) => {
    const c = (k) => (r.sources[k] ? `${r.sources[k].verified}${r.sources[k].verified >= 20 ? " ✅" : " ⚠️"}` : "-");
    lines.push(`| ${i + 1} | ${r.label} | \`${r.input.length > 50 ? r.input.slice(0, 47) + "..." : r.input}\` | ${r.status} | ${c("instagram")} | ${c("meta_ads")} | ${r.seconds ?? "-"}s |`);
  });
  if (repeat) {
    lines.push("", "## Repeat search (uniqueness)", "");
    lines.push(`Searched **${repeat.input}** twice in a row.`, "");
    lines.push(`- First run: ${repeat.first} verified videos`, `- Second run: ${repeat.second} verified videos`, `- Videos returned by both runs: **${repeat.overlap}**`);
  }
  lines.push("", "## Per product", "");
  results.forEach((r, i) => {
    lines.push(`### ${i + 1}. ${r.label}`, "", `Input: \`${r.input}\``, "");
    if (r.error) lines.push(`Error: ${r.error}`, "");
    if (r.detected) {
      lines.push(`Analysis: **${r.analysisMode}**. Detected: ${r.detected.type} · brand ${r.detected.brand} · colours ${r.detected.colours.join(", ") || "-"} · text on product ${r.detected.text.join(", ") || "-"}`, "");
      lines.push(`Top hashtags: ${r.detected.hashtags.map((h) => `#${h}`).join(" ")}`, "");
    }
    lines.push("| Source | Status | Fetched | Duplicates | Seen before | Checked | Verified | Below threshold | Rounds |", "|---|---|---|---|---|---|---|---|---|");
    for (const [k, name] of SOURCES) {
      const s = r.sources[k];
      if (s) lines.push(`| ${name} | ${s.status} | ${s.fetched} | ${s.duplicates} | ${s.previouslySeen} | ${s.scored} | ${s.verified} | ${s.below} | ${s.rounds} |`);
    }
    const ex = (list, title) => {
      if (!list.length) return;
      lines.push("", `**${title}**`, "");
      list.forEach((e) => lines.push(`- ${e.score} (${e.verdict}) · ${e.platform} · ${e.reason} · [link](${e.url})`));
    };
    ex(r.goodExamples, "Good matches (highest scores)");
    ex(r.rejectedExamples, "Rejected (highest-scoring videos below the threshold)");
    lines.push("");
  });
  return lines.join("\n");
}

async function main() {
  const custom = process.argv[2];
  const products = custom ? JSON.parse(await fs.readFile(custom, "utf8")) : DEFAULT_PRODUCTS;
  const health = await api("/health");
  console.log("Backend:", health);
  if (health.providerMode !== "live" || health.scraper !== "apify" || !health.vision.startsWith("gemini")) {
    console.warn("\n⚠ Not running with live scraping + Gemini; results will not reflect real accuracy.\n");
  }

  const results = [];
  for (const p of products) {
    process.stdout.write(`→ ${p.label}: ${p.input} … `);
    try {
      const job = await runSearch(p.input);
      const s = summarize(p.label, p.input, job);
      results.push(s);
      console.log(`${s.status} (IG ${s.sources.instagram?.verified ?? 0}, Meta ${s.sources.meta_ads?.verified ?? 0}, ${s.seconds}s)`);
    } catch (err) {
      console.log("ERROR", err.message);
      results.push({ label: p.label, input: p.input, status: "error", error: err.message, sources: {}, goodExamples: [], rejectedExamples: [], acceptedKeys: [] });
    }
  }

  // Uniqueness: repeat the first successful search and measure overlap.
  let repeat = null;
  const first = results.find((r) => r.acceptedKeys?.length);
  if (first) {
    process.stdout.write(`→ Repeat search: ${first.input} … `);
    const again = summarize(first.label, first.input, await runSearch(first.input));
    const overlap = again.acceptedKeys.filter((k) => first.acceptedKeys.includes(k)).length;
    repeat = { input: first.input, first: first.acceptedKeys.length, second: again.acceptedKeys.length, overlap, jobId: again.jobId };
    console.log(`${again.acceptedKeys.length} verified, ${overlap} overlap`);
  }

  const outDir = path.join(ROOT, "docs");
  await fs.mkdir(outDir, { recursive: true });
  await fs.writeFile(path.join(outDir, "test-results.json"), JSON.stringify({ health, results, repeat }, null, 2));
  await fs.writeFile(path.join(outDir, "test-results.md"), markdown(results, repeat, health.matchThreshold));
  console.log(`\nWrote ${path.join(outDir, "test-results.md")}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
