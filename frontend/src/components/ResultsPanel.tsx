import { useMemo, useState } from "react";
import { Platform, PLATFORM_LABEL, SearchJob, SourceSummary, VideoCandidate } from "../types";
import VideoCard from "./VideoCard";

type Tab = Platform | "all";
type Sort = "score" | "newest";
type Item = { video: VideoCandidate; kind: "accepted" | "below" | "seen" };

interface Props {
  job: SearchJob;
  shortlistKeys: Set<string>;
  onToggleShortlist: (v: VideoCandidate) => void;
  onOpenSearch: (jobId: string) => void;
  onRetry: () => void;
}

const ORDER: Platform[] = ["instagram", "meta_ads", "tiktok"];

export default function ResultsPanel({ job, shortlistKeys, onToggleShortlist, onOpenSearch, onRetry }: Props) {
  const [tab, setTab] = useState<Tab>("instagram");
  const [sort, setSort] = useState<Sort>("score");
  const [minScore, setMinScore] = useState(0);
  const [showBelow, setShowBelow] = useState(false);
  const [showSeen, setShowSeen] = useState(false);

  const min = job.minimumPerSource;
  const sources = ORDER.map((p) => job.sources[p]).filter((s): s is SourceSummary => Boolean(s && s.enabled));
  const visible = tab === "all" ? sources : sources.filter((s) => s.platform === tab);
  const running = !["completed", "partial", "failed"].includes(job.status);

  const items = useMemo(() => {
    const list: Item[] = visible.flatMap((s) => [
      ...s.accepted.map((video) => ({ video, kind: "accepted" as const })),
      ...(showBelow ? s.belowThreshold.map((video) => ({ video, kind: "below" as const })) : []),
      ...(showSeen ? s.previouslySeen.map((video) => ({ video, kind: "seen" as const })) : []),
    ]);
    const filtered = list.filter((i) => i.kind === "seen" || (i.video.match?.score ?? 0) >= minScore);
    return filtered.sort((a, b) =>
      sort === "newest"
        ? (b.video.postedAt || "").localeCompare(a.video.postedAt || "")
        : (b.video.match?.score ?? -1) - (a.video.match?.score ?? -1)
    );
  }, [visible, showBelow, showSeen, minScore, sort]);

  const hiddenBelow = visible.reduce((n, s) => n + s.belowThreshold.length, 0);
  const hiddenSeen = visible.reduce((n, s) => n + s.previouslySeen.length, 0);

  return (
    <section className="bg-white border border-slate-200 rounded-xl">
      {/* Tabs with live counts against the minimum */}
      <div className="flex overflow-x-auto border-b border-slate-200" role="tablist">
        {sources.map((s) => {
          const count = s.accepted.length;
          const required = s.platform !== "tiktok";
          const ok = !required || count >= min;
          return (
            <button
              key={s.platform}
              role="tab"
              aria-selected={tab === s.platform}
              onClick={() => setTab(s.platform)}
              className={`px-4 py-3 text-sm whitespace-nowrap border-b-2 -mb-px flex items-center gap-2 ${tab === s.platform ? "border-brand-600 text-slate-900 font-medium" : "border-transparent text-slate-500 hover:text-slate-700"}`}
            >
              {PLATFORM_LABEL[s.platform]}
              <span className={`text-xs rounded-full px-2 py-0.5 ${s.status === "failed" ? "bg-red-100 text-red-700" : ok ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
                {count}
                {required ? `/${min}` : ""}
                {s.status === "running" && " …"}
              </span>
            </button>
          );
        })}
        <button role="tab" aria-selected={tab === "all"} onClick={() => setTab("all")} className={`px-4 py-3 text-sm whitespace-nowrap border-b-2 -mb-px ${tab === "all" ? "border-brand-600 text-slate-900 font-medium" : "border-transparent text-slate-500 hover:text-slate-700"}`}>
          All platforms
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3 border-b border-slate-100 text-xs text-slate-600">
        <label className="flex items-center gap-2">
          Sort
          <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="border border-slate-200 rounded-md px-2 py-1 bg-white">
            <option value="score">Match score</option>
            <option value="newest">Newest first</option>
          </select>
        </label>
        <label className="flex items-center gap-2">
          Min score
          <input type="range" min={0} max={100} step={5} value={minScore} onChange={(e) => setMinScore(Number(e.target.value))} />
          <span className="w-6 tabular-nums">{minScore}</span>
        </label>
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={showBelow} onChange={(e) => setShowBelow(e.target.checked)} />
          Show below threshold ({hiddenBelow})
        </label>
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={showSeen} onChange={(e) => setShowSeen(e.target.checked)} />
          Show previously seen ({hiddenSeen})
        </label>
      </div>

      <div className="p-4 flex flex-col gap-3">
        {/* Per-source state: errors, shortfalls, live progress */}
        {visible.map((s) => (
          <SourceNotice key={s.platform} source={s} min={min} running={running} onRetry={onRetry} />
        ))}

        {items.length > 0 ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4">
            {items.map(({ video, kind }) => (
              <VideoCard key={`${kind}:${video.key}`} video={video} kind={kind} shortlisted={shortlistKeys.has(video.key)} onToggleShortlist={onToggleShortlist} onOpenSearch={onOpenSearch} />
            ))}
          </div>
        ) : running ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="aspect-[4/5] rounded-xl bg-slate-100 animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="text-center text-sm text-slate-500 py-10">
            <p className="font-medium text-slate-600">No videos to show here.</p>
            <p className="mt-1">
              {minScore > 0 ? "Lower the minimum score, or " : ""}
              {hiddenBelow > 0 ? `turn on "Show below threshold" to see ${hiddenBelow} weaker matches, or ` : ""}
              try a product link or photo for a more precise search.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

function SourceNotice({ source: s, min, running, onRetry }: { source: SourceSummary; min: number; running: boolean; onRetry: () => void }) {
  const name = PLATFORM_LABEL[s.platform];
  if (s.status === "failed") {
    return (
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-red-50 text-red-800 text-sm rounded-lg px-3 py-2">
        <span>
          <b>{name} failed:</b> {s.error || "unknown error"}
        </span>
        <button onClick={onRetry} className="text-xs font-medium underline shrink-0">
          Retry search
        </button>
      </div>
    );
  }
  if (s.status === "running" || (running && s.status === "pending")) {
    return (
      <p className="text-xs text-slate-500">
        {name}: {s.accepted.length}/{min} verified so far · {s.stats.fetched} fetched · {s.stats.scored} checked · round {s.stats.rounds || 1}
      </p>
    );
  }
  if (s.shortfall && s.platform !== "tiktok") {
    return (
      <div className="bg-amber-50 text-amber-900 text-sm rounded-lg px-3 py-2">
        <b>{name}: below the {min}-video minimum.</b> {s.shortfall}
      </div>
    );
  }
  return (
    <p className="text-xs text-slate-500">
      {name}: {s.accepted.length} verified · {s.stats.fetched} fetched · {s.stats.duplicates} duplicates removed · {s.stats.previouslySeen} seen before · {s.stats.scored} checked by the image brain
    </p>
  );
}
