import { useState } from "react";
import { ProductIdentity } from "../types";
import { refImageUrl } from "../services/api";

function Row({ label, values }: { label: string; values: string[] | string }) {
  const list = (Array.isArray(values) ? values : [values]).filter((v) => v && v !== "unknown");
  if (!list.length) return null;
  return (
    <div className="flex gap-2 text-xs">
      <dt className="w-24 shrink-0 text-slate-400">{label}</dt>
      <dd className="flex flex-wrap gap-1">
        {list.map((v, i) => (
          <span key={i} className="bg-brand-50 text-brand-700 rounded-full px-2 py-0.5">
            {v}
          </span>
        ))}
      </dd>
    </div>
  );
}

const MODE_LABEL = {
  vision: { text: "Analysed from photo", cls: "bg-emerald-100 text-emerald-700" },
  text: { text: "No photo: text-only analysis", cls: "bg-amber-100 text-amber-700" },
  heuristic: { text: "No AI key: keyword analysis", cls: "bg-red-100 text-red-700" },
};

export default function ProductPanel({ product }: { product: ProductIdentity }) {
  const [showTerms, setShowTerms] = useState(false);
  const a = product.attributes;
  const img = refImageUrl(product.imageId) || product.imageUrl || undefined;
  const mode = MODE_LABEL[product.analysisMode];

  return (
    <section className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col gap-4">
      <div className="flex gap-4">
        <div className="w-24 h-24 sm:w-28 sm:h-28 rounded-lg bg-slate-100 overflow-hidden shrink-0 flex items-center justify-center">
          {img ? <img src={img} alt={product.title} className="w-full h-full object-contain" /> : <span className="text-xs text-slate-400 px-2 text-center">No reference photo</span>}
        </div>
        <div className="min-w-0">
          <h2 className="font-semibold text-slate-800 leading-snug break-words">{product.title}</h2>
          {product.sourceUrl && (
            <a href={product.sourceUrl} target="_blank" rel="noreferrer" className="text-xs text-brand-700 hover:underline break-all line-clamp-1">
              {new URL(product.sourceUrl).hostname}
            </a>
          )}
          <div className="mt-2 flex flex-wrap gap-1.5">
            <span className={`text-[11px] font-medium rounded-full px-2 py-0.5 ${mode.cls}`}>{mode.text}</span>
            {product.imageSource && <span className="text-[11px] rounded-full px-2 py-0.5 bg-slate-100 text-slate-600">Photo from {product.imageSource === "upload" ? "your upload" : "product page"}</span>}
          </div>
        </div>
      </div>

      {a.summary && a.summary !== product.title && <p className="text-sm text-slate-600">{a.summary}</p>}

      {!product.imageId && (
        <p className="text-xs bg-amber-50 text-amber-800 rounded-lg px-3 py-2">
          No reference photo, so videos are matched against the description only. Upload a product photo or paste a product link for exact-product matching.
        </p>
      )}

      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">What the image brain detected</h3>
        <dl className="flex flex-col gap-1.5">
          <Row label="Type" values={a.productType} />
          <Row label="Brand" values={a.brand} />
          <Row label="Colours" values={a.colours} />
          <Row label="Prints / graphics" values={a.printsOrGraphics} />
          <Row label="Logos" values={a.logos} />
          <Row label="Text on product" values={a.textOnProduct} />
          <Row label="Material" values={a.material} />
          <Row label="Shape" values={a.shape} />
          <Row label="Distinctive" values={a.distinctiveFeatures} />
        </dl>
      </div>

      <div>
        <button onClick={() => setShowTerms((v) => !v)} className="text-xs text-brand-700 hover:underline">
          {showTerms ? "Hide" : "Show"} generated search terms
        </button>
        {showTerms && (
          <dl className="mt-2 flex flex-col gap-1.5">
            <Row label="Instagram" values={product.searchPlan.instagramHashtags.map((t) => `#${t}`)} />
            <Row label="Meta ads" values={product.searchPlan.metaKeywords} />
            <Row label="TikTok" values={product.searchPlan.tiktokKeywords} />
          </dl>
        )}
      </div>
    </section>
  );
}
