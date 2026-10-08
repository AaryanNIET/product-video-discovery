import { ProgressStep, SearchJob } from "../types";

const STEPS: Array<{ key: string; label: string }> = [
  { key: "queued", label: "Starting search" },
  { key: "fetch_page", label: "Fetching product page" },
  { key: "analyse_image", label: "Analysing product image" },
  { key: "search_instagram", label: "Searching Instagram Reels" },
  { key: "search_meta_ads", label: "Searching Meta Ad Library" },
  { key: "search_tiktok", label: "Searching TikTok" },
  { key: "scoring", label: "Scoring matches" },
];

const DOT: Record<ProgressStep["status"], string> = {
  pending: "bg-slate-300",
  active: "bg-brand-500 animate-pulse",
  done: "bg-emerald-500",
  error: "bg-red-500",
  skipped: "bg-slate-200",
};

export default function ProgressPanel({ job }: { job: SearchJob }) {
  const byStep = new Map(job.progress.map((p) => [p.step, p]));
  const finished = ["completed", "partial", "failed"].includes(job.status);
  const statusText = {
    queued: "Queued",
    running: "Running…",
    completed: "Done: every source met the minimum",
    partial: "Done with shortfalls (see below)",
    failed: "Failed",
  }[job.status];

  return (
    <section className="bg-white border border-slate-200 rounded-xl p-5" aria-live="polite">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-slate-700">Pipeline</h3>
        <span className={`text-xs font-medium ${job.status === "failed" ? "text-red-600" : job.status === "partial" ? "text-amber-600" : finished ? "text-emerald-600" : "text-brand-700"}`}>
          {statusText}
        </span>
      </div>
      <ol className="space-y-2.5">
        {STEPS.map(({ key, label }) => {
          const s = byStep.get(key);
          const status = s?.status || "pending";
          if (key === "queued" && status !== "active") return null;
          return (
            <li key={key} className="flex items-start gap-3 text-sm">
              <span className={`mt-1.5 w-2.5 h-2.5 rounded-full shrink-0 ${DOT[status]}`} />
              <div className="min-w-0">
                <p className={status === "pending" || status === "skipped" ? "text-slate-400" : status === "error" ? "text-red-700" : "text-slate-700"}>
                  {label}
                  {status === "skipped" && <span className="text-xs"> (skipped)</span>}
                </p>
                {s?.detail && <p className={`text-xs break-words ${status === "error" ? "text-red-600" : "text-slate-400"}`}>{s.detail}</p>}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
