import { useMemo, useState } from "react";
import { SourceResult } from "../types";
import ResultCard from "./ResultCard";

interface Props {
  title: string;
  minimum: number;
  result: SourceResult | null;
  loading: boolean;
  onRetry: () => void;
}

type SortKey = "score" | "newest";

export default function ResultsSection({ title, minimum, result, loading, onRetry }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>("score");
  const [minScore, setMinScore] = useState(0);

  const candidates = result?.candidates || [];
  const count = candidates.length;

  const sorted = useMemo(() => {
    const filtered = candidates.filter((c) => (c.finalScore ?? 0) >= minScore);
    if (sortKey === "score") return [...filtered].sort((a, b) => (b.finalScore ?? 0) - (a.finalScore ?? 0));
    return filtered; // "newest" = provider order, already most-recent-first from mock/live data
  }, [candidates, sortKey, minScore]);

  return (
    <section className="bg-white border border-slate-200 rounded-xl p-5">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <h3 className="font-semibold text-slate-800">{title}</h3>
          <span
            className={
              "text-xs font-medium rounded-full px-2 py-0.5 " +
              (count >= minimum ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700")
            }
          >
            {count}/{minimum}
          </span>
          {result?.status === "failed" && (
            <span className="text-xs font-medium rounded-full px-2 py-0.5 bg-red-100 text-red-700">Provider failed</span>
          )}
          {result?.status === "partial" && (
            <span className="text-xs font-medium rounded-full px-2 py-0.5 bg-amber-100 text-amber-700">Partial</span>
          )}
        </div>
        <div className="flex items-center gap-2 text-xs">
          <label className="text-slate-500">Sort</label>
          <select
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as SortKey)}
            className="border border-slate-200 rounded-md px-2 py-1"
          >
            <option value="score">Match score</option>
            <option value="newest">Newest first</option>
          </select>
          <label className="text-slate-500 ml-2">Min score</label>
          <input
            type="range"
            min={0}
            max={100}
            value={minScore}
            onChange={(e) => setMinScore(Number(e.target.value))}
          />
          <span className="text-slate-500 w-7">{minScore}</span>
        </div>
      </div>

      {result?.error && (
        <div className="flex items-center justify-between bg-red-50 text-red-700 text-sm rounded-lg px-3 py-2 mb-4">
          <span>{result.error}</span>
          <button onClick={onRetry} className="text-xs font-medium underline shrink-0 ml-3">
            Retry
          </button>
        </div>
      )}

      {result?.shortfallReason && count < minimum && !result.error && (
        <div className="bg-amber-50 text-amber-700 text-sm rounded-lg px-3 py-2 mb-4">{result.shortfallReason}</div>
      )}

      {loading && !result && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="aspect-[4/5] rounded-xl bg-slate-100 animate-pulse" />
          ))}
        </div>
      )}

      {!loading && result && count === 0 && !result.error && (
        <p className="text-sm text-slate-500 py-6 text-center">No verified matches found for this source yet.</p>
      )}

      {sorted.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {sorted.map((c) => (
            <ResultCard key={c.id} candidate={c} />
          ))}
        </div>
      )}
    </section>
  );
}
