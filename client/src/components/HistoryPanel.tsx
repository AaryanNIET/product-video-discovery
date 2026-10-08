import { HistoryItem } from "../types";

export default function HistoryPanel({ items, onSelect }: { items: HistoryItem[]; onSelect: (input: string) => void }) {
  if (!items.length) return null;
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5">
      <h3 className="text-sm font-semibold text-slate-700 mb-3">Search history</h3>
      <ul className="divide-y divide-slate-100">
        {items.map((h) => (
          <li key={h.jobId} className="py-2 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm text-slate-700 truncate">{h.productName || h.sourceInput}</p>
              <p className="text-xs text-slate-400">
                {h.instagramCount} IG · {h.metaAdsCount} Meta · {h.status}
              </p>
            </div>
            <button
              onClick={() => h.sourceInput && onSelect(h.sourceInput)}
              className="text-xs text-brand-700 shrink-0 hover:underline"
            >
              Search again
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
