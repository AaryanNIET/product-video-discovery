import { HistoryItem } from "../types";
import { refImageUrl } from "../services/api";

interface Props {
  items: HistoryItem[];
  activeJobId?: string;
  onOpen: (jobId: string) => void;
  onRerun: (item: HistoryItem) => void;
}

const STATUS_CLS: Record<string, string> = {
  completed: "text-emerald-600",
  partial: "text-amber-600",
  failed: "text-red-600",
  running: "text-brand-700",
  queued: "text-slate-500",
};

export default function HistoryPanel({ items, activeJobId, onOpen, onRerun }: Props) {
  return (
    <section className="bg-white border border-slate-200 rounded-xl p-5">
      <h3 className="text-sm font-semibold text-slate-700 mb-3">Search history</h3>
      {!items.length ? (
        <p className="text-sm text-slate-400">Your searches will appear here.</p>
      ) : (
        <ul className="divide-y divide-slate-100 max-h-[28rem] overflow-y-auto -mx-2">
          {items.map((h) => (
            <li key={h.jobId} className={`px-2 py-2 flex items-center gap-3 rounded-lg ${h.jobId === activeJobId ? "bg-brand-50" : ""}`}>
              <button onClick={() => onOpen(h.jobId)} className="flex items-center gap-3 min-w-0 flex-1 text-left" title="Open these results">
                <div className="w-9 h-9 rounded bg-slate-100 overflow-hidden shrink-0">{h.imageId && <img src={refImageUrl(h.imageId)} alt="" className="w-full h-full object-cover" />}</div>
                <div className="min-w-0">
                  <p className="text-sm text-slate-700 truncate">{h.title}</p>
                  <p className="text-xs text-slate-400">
                    IG {h.counts.instagram ?? 0} · Meta {h.counts.meta_ads ?? 0}
                    {h.counts.tiktok ? ` · TikTok ${h.counts.tiktok}` : ""} · <span className={STATUS_CLS[h.status] || ""}>{h.status}</span> · {new Date(h.createdAt).toLocaleString([], { dateStyle: "short", timeStyle: "short" })}
                  </p>
                </div>
              </button>
              {h.input && (
                <button onClick={() => onRerun(h)} className="text-xs text-brand-700 shrink-0 hover:underline" title="Search again for new videos">
                  Search again
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
