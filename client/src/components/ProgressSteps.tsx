import { ProgressStep } from "../types";

const LABELS: Record<string, string> = {
  resolve_product: "Resolving product",
  generate_queries: "Generating search queries",
  search_instagram: "Searching Instagram Reels",
  search_meta_ads: "Searching Meta Ad Library",
  dedupe: "Removing duplicates",
  text_filter: "Text-filtering candidates",
  visual_verification: "AI visual verification",
  ranking: "Ranking results",
};

export default function ProgressSteps({ steps }: { steps: ProgressStep[] }) {
  const order = Object.keys(LABELS);
  const latestByStep = new Map<string, ProgressStep>();
  steps.forEach((s) => latestByStep.set(s.step, s));

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5">
      <h3 className="text-sm font-semibold text-slate-700 mb-3">Pipeline progress</h3>
      <ol className="space-y-2">
        {order.map((key) => {
          const s = latestByStep.get(key);
          const status = s?.status || "pending";
          return (
            <li key={key} className="flex items-center gap-3 text-sm">
              <span
                className={
                  "w-2.5 h-2.5 rounded-full shrink-0 " +
                  (status === "done"
                    ? "bg-emerald-500"
                    : status === "active"
                    ? "bg-brand-500 animate-pulse"
                    : status === "error"
                    ? "bg-red-500"
                    : "bg-slate-300")
                }
              />
              <span className={status === "pending" ? "text-slate-400" : "text-slate-700"}>{LABELS[key]}</span>
              {s?.detail && <span className="text-xs text-slate-400 ml-auto">{s.detail}</span>}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
