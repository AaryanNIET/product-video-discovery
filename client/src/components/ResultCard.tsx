import { VideoCandidate } from "../types";

export default function ResultCard({ candidate }: { candidate: VideoCandidate }) {
  const score = candidate.finalScore ?? 0;
  const scoreColor = score >= 75 ? "bg-emerald-100 text-emerald-700" : score >= 50 ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-600";

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden flex flex-col">
      <div className="aspect-[4/5] bg-slate-100">
        {candidate.thumbnailUrl ? (
          <img src={candidate.thumbnailUrl} alt={candidate.title || ""} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-xs text-slate-400">No thumbnail</div>
        )}
      </div>
      <div className="p-3 flex flex-col gap-1.5 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] uppercase tracking-wide text-slate-400 font-medium">
            {candidate.platform === "instagram" ? "Instagram Reel" : "Meta Ad"}
          </span>
          <span className={`text-xs font-semibold rounded-full px-2 py-0.5 ${scoreColor}`}>{score}</span>
        </div>
        {candidate.creator && <p className="text-xs text-slate-500 truncate">{candidate.creator}</p>}
        {candidate.caption && <p className="text-sm text-slate-700 line-clamp-2">{candidate.caption}</p>}
        {candidate.verification?.evidence?.length ? (
          <p className="text-xs text-slate-400 line-clamp-2 mt-auto">{candidate.verification.evidence.join(" · ")}</p>
        ) : null}
        <a
          href={candidate.url}
          target="_blank"
          rel="noreferrer"
          className="mt-2 text-xs text-center text-brand-700 border border-brand-200 rounded-lg py-1.5 hover:bg-brand-50 transition"
        >
          Open Original
        </a>
      </div>
    </div>
  );
}
